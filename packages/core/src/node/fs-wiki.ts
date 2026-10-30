// 노트북에 clone된 family-wiki를 다루는 WikiRepository 구현 (Node 전용).
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WikiRepository, WriteResult } from "../ports";
import { DEFAULT_FAMILY_ID, type Change, type FamilyId, type SetupInput, type WikiState } from "../types";
import { applyChange, formatLogLine, type ApplyResult, type WikiFiles } from "../wiki/apply";
import { readWiki } from "../wiki/read";
import { SetupError, buildSetupFiles } from "../wiki/setup";

const run = promisify(execFile);

export interface FsWikiOptions {
  /** 이 저장소가 맡은 가족. 기본 DEFAULT_FAMILY_ID. 메서드가 다른 가족 id로 불리면 거부한다(한 폴더 = 한 가족). */
  familyId?: FamilyId;
  /** 위키 레포 경로 (WIKI_REPO_PATH) */
  root: string;
  /** commit 후 push할지. 원격이 없으면 건너뛴다. 기본 true */
  push?: boolean;
  /** log.md에 남길 작성자 */
  author?: string;
  /** 읽기 전용(예시 위키 등). git 루트 검사를 건너뛰고 apply를 막는다. */
  readOnly?: boolean;
  /** 경고 기록(push 실패 원인 등). 기본 console.warn */
  warn?: (message: string) => void;
  now?: () => Date;
  random?: () => number;
}

/**
 * apply 결과. 포트 결과(WriteResult)에 이 구현의 정보를 더한다.
 * version = 이번 커밋의 sha. 커밋은 항상 만들어졌고, push는 실패할 수 있다(synced:false, 다음 쓰기 때 같이 올라간다).
 * synced = 원격에 올렸는지(원격이 없거나 push 옵션이 꺼져 있거나 push가 실패하면 false), syncError = push 실패 원인(git 메시지 요약).
 */
export interface ApplyOutcome extends ApplyResult, WriteResult {}

/** applySetup 결과: 쓰기 결과와 요약 */
export interface SetupOutcome extends WriteResult {
  summary: string;
}

/** 이 저장소가 맡지 않은 가족 id로 불렸다 */
export class FamilyMismatchError extends Error {
  constructor(expected: FamilyId, got: FamilyId) {
    super(`이 위키 저장소는 가족 ${expected}의 것이에요(요청: ${got})`);
    this.name = "FamilyMismatchError";
  }
}

/** git 실행 오류에서 사람이 읽을 원인만 뽑는다(stderr의 error·fatal·rejected 줄 우선). */
export function gitReason(e: unknown): string {
  const err = (typeof e === "object" && e !== null ? e : {}) as { stderr?: unknown; message?: unknown };
  const raw = (typeof err.stderr === "string" && err.stderr.trim()) || (typeof err.message === "string" ? err.message : String(e));
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const key = lines.filter((l) => /^(error|fatal|!|remote:|CONFLICT)/.test(l));
  return (key.length ? key : lines).slice(0, 3).join(" / ").slice(0, 400);
}

/** 위키 경로가 독립 git 레포의 루트인지: 더 큰 레포 안의 폴더면 엉뚱한 레포에 커밋하게 된다. */
export function assertGitRoot(root: string): void {
  let top: string;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error(`위키 경로가 git 레포가 아니에요: ${root}`);
  }
  if (realpathSync(top) !== realpathSync(root)) {
    throw new Error(`위키 경로가 git 레포의 루트가 아니에요: ${root} (루트: ${top})`);
  }
}

export class FsWikiRepository implements WikiRepository {
  private readonly root: string;
  readonly familyId: FamilyId;
  /** 쓰기는 한 번에 하나씩 (같은 파일 동시 수정 방지) */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: FsWikiOptions) {
    this.root = resolve(opts.root);
    this.familyId = opts.familyId ?? DEFAULT_FAMILY_ID;
    if (!opts.readOnly) assertGitRoot(this.root);
  }

  private path(rel: string): string {
    const p = resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`위키 밖 경로: ${rel}`);
    return p;
  }

  readonly files: WikiFiles = {
    read: (rel) => {
      const p = this.path(rel);
      return existsSync(p) ? readFileSync(p, "utf8") : undefined;
    },
    list: (dir) => {
      const p = this.path(dir);
      return existsSync(p) ? readdirSync(p).sort() : [];
    },
  };

  private assertFamily(familyId: FamilyId) {
    if (familyId !== this.familyId) throw new FamilyMismatchError(this.familyId, familyId);
  }

  async read(familyId: FamilyId): Promise<WikiState> {
    this.assertFamily(familyId);
    return readWiki(this.files, this.familyId);
  }

  async apply(familyId: FamilyId, change: Change, by = this.opts.author ?? "bot"): Promise<ApplyOutcome> {
    this.assertFamily(familyId);
    if (this.opts.readOnly) throw new Error("읽기 전용 위키에는 쓸 수 없어요");
    return this.enqueue(() => this.applyNow(change, by));
  }

  /** 메인 PC에서 고친 내용 반영 (1분마다). 쓰기와 같은 큐를 타서 apply 도중에 끼어들지 않는다. */
  async pull(): Promise<void> {
    if (this.opts.readOnly) throw new Error("읽기 전용 위키는 pull하지 않아요");
    return this.enqueue(async () => {
      await this.assertReady();
      if (!(await this.hasRemote())) return;
      try {
        await this.git("pull", "--rebase", "--autostash");
      } catch (e) {
        // 충돌 등으로 rebase가 도중에 멈추면 레포가 그 상태로 남아 다음 apply가 엉뚱한 데 커밋한다 -> 되돌린다.
        const detail = await this.abortInProgress();
        throw new Error(`pull 실패 (되돌림${detail}): ${gitReason(e)}`, { cause: e });
      }
      const unmerged = (await this.git("diff", "--name-only", "--diff-filter=U")).stdout.trim();
      if (unmerged) {
        // autostash를 다시 적용하다 충돌: 작업 내용은 stash에 남아 있다. 충돌 표시가 든 작업 트리만 버린다.
        await this.git("reset", "-q", "--hard", "HEAD");
        throw new Error(`pull 뒤 로컬 수정을 되살리다 충돌했어요(수정은 git stash list에 남아 있음): ${unmerged.split("\n").join(", ")}`);
      }
    });
  }

  /** 진행 중인 rebase·merge를 취소한다(autostash도 함께 복구). 무엇을 했는지 짧은 설명을 돌려준다. */
  private async abortInProgress(): Promise<string> {
    try {
      const state = this.inProgress();
      if (state === "rebase") await this.git("rebase", "--abort");
      else if (state === "merge") await this.git("merge", "--abort");
      else return "";
      return `: ${state} 취소`;
    } catch (e) {
      return `: 취소도 실패 - ${gitReason(e)}`;
    }
  }

  private gitPath(name: string): string {
    const p = execFileSync("git", ["rev-parse", "--git-path", name], { cwd: this.root, encoding: "utf8" }).trim();
    return resolve(this.root, p);
  }

  private inProgress(): "rebase" | "merge" | "cherry-pick" | "revert" | undefined {
    if (existsSync(this.gitPath("rebase-merge")) || existsSync(this.gitPath("rebase-apply"))) return "rebase";
    if (existsSync(this.gitPath("MERGE_HEAD"))) return "merge";
    if (existsSync(this.gitPath("CHERRY_PICK_HEAD"))) return "cherry-pick";
    if (existsSync(this.gitPath("REVERT_HEAD"))) return "revert";
    return undefined;
  }

  /** 쓰기·pull 전에: 레포가 rebase·merge 도중이거나 detached HEAD면 거부한다(엉뚱한 곳에 커밋하지 않게). */
  private async assertReady() {
    const state = this.inProgress();
    if (state) throw new Error(`위키 레포가 ${state} 진행 중이라 쓸 수 없어요. 메인 PC나 노트북에서 직접 정리해 주세요: ${this.root}`);
    const head = await this.git("symbolic-ref", "-q", "HEAD").then(
      () => true,
      () => false,
    );
    if (!head) throw new Error(`위키 레포가 브랜치 위에 있지 않아요(detached HEAD). 브랜치로 돌아간 뒤에 쓸 수 있어요: ${this.root}`);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async applyNow(change: Change, by: string): Promise<ApplyOutcome> {
    await this.assertReady();
    const result = applyChange(this.files, change, this.opts.random);
    const at = formatSeoul(this.opts.now?.() ?? new Date());
    const log = this.files.read("log.md") ?? "# 변경 기록\n";
    result.files.set("log.md", `${log.replace(/\n*$/, "\n")}${formatLogLine(at, change.kind, result.summary, by, result.id)}\n`);

    return this.commitFiles(result.files, `[${change.kind}] ${result.summary}`, by, { ...result });
  }

  /** 첫 세팅 전용(WikiRepository.applySetup). 쓰기 큐 안에서 검사하고 커밋 하나로 쓴다. */
  async applySetup(familyId: FamilyId, setup: SetupInput, opts: { overwrite?: boolean } = {}, by = this.opts.author ?? "setup"): Promise<SetupOutcome> {
    this.assertFamily(familyId);
    if (this.opts.readOnly) throw new SetupError("읽기 전용 위키에는 쓸 수 없어요", "read_only");
    return this.enqueue(async () => {
      await this.assertReady();
      const now = this.opts.now?.() ?? new Date();
      const at = formatSeoul(now);
      // 검증·세팅 필요 판정·덮어쓰기 확인은 큐 안에서(동시에 두 번 눌러도 한 번만 쓴다)
      const built = buildSetupFiles(this.files, setup, `${at.replace(" ", "T")}:00+09:00`, opts);
      const files = new Map(built.files);
      const log = this.files.read("log.md") ?? "# 변경 기록\n";
      files.set("log.md", `${log.replace(/\n*$/, "\n")}${formatLogLine(at, "setup", built.summary, by)}\n`);
      return this.commitFiles(files, `[setup] ${built.summary}`, by, { summary: built.summary });
    });
  }

  /**
   * 파일들을 쓰고(null이면 삭제) 경로를 지정해 커밋 하나로 묶고 push한다. commit까지 못 가면 파일·index를 원래대로 되돌린다.
   * 호출자는 쓰기 큐 안에 있어야 한다.
   */
  private async commitFiles<R extends { summary: string }>(writes: Map<string, string | null>, message: string, by: string, result: R): Promise<R & WriteResult> {
    const rels = [...writes.keys()];
    const before = new Map(rels.map((rel) => [rel, this.files.read(rel)]));
    // 사람이 미리 stage해 둔 내용을 롤백이 풀어 버리지 않게, 우리가 건드릴 파일의 index 항목을 기억해 둔다.
    const index = await this.indexEntries(rels);
    let commit: string;
    try {
      // 지우기를 먼저(대소문자만 다른 이름이 새 파일을 지우지 않게)
      for (const [rel, content] of writes) if (content === null) rmSync(this.path(rel), { force: true });
      for (const [rel, content] of writes) {
        if (content === null) continue;
        const p = this.path(rel);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content, "utf8");
      }
      // git이 모르는 파일을 지운 경우(untracked였다가 삭제)는 add·commit 대상에서 뺀다 - pathspec 오류가 난다.
      const gitRels = rels.filter((rel) => writes.get(rel) !== null || index.has(rel) || before.get(rel) === undefined);
      await this.git("add", "-A", "--", ...gitRels);
      // 경로를 지정해 우리가 쓴 파일만 커밋한다(사람이 stage해 둔 다른 파일이 딸려 들어가지 않게).
      await this.git("commit", "-m", message, "--author", `${by} <bot@homesweethome.local>`, "--", ...gitRels);
      commit = (await this.git("rev-parse", "HEAD")).stdout.trim();
    } catch (e) {
      await this.rollback(before, index);
      throw e;
    }

    let synced = false;
    let syncError: string | undefined;
    if (this.opts.push !== false) {
      try {
        if (await this.hasRemote()) {
          await this.git("push");
          synced = true;
        }
      } catch (e) {
        // 커밋은 이미 로컬에 있다. push는 다음 apply나 점검 때 다시 시도한다. 원인은 남긴다.
        syncError = gitReason(e);
        (this.opts.warn ?? console.warn)(`[wiki] push 실패(커밋은 로컬에 남음): ${syncError}`);
      }
    }
    return { ...result, version: commit, synced, ...(syncError ? { syncError } : {}) };
  }

  /** index(stage) 항목: rel -> "모드 해시" (index에 없으면 항목 없음) */
  private async indexEntries(rels: string[]): Promise<Map<string, string>> {
    const out = (await this.git("ls-files", "-s", "--", ...rels)).stdout;
    const m = new Map<string, string>();
    for (const line of out.split("\n").filter(Boolean)) {
      const [meta, rel] = line.split("\t");
      const [mode, sha] = (meta ?? "").split(" ");
      if (rel && mode && sha) m.set(rel, `${mode},${sha}`);
    }
    return m;
  }

  /** commit까지 못 갔을 때: 파일을 원래대로(없던 파일은 삭제) 되돌리고 index 항목도 원래 값으로 복구한다. */
  private async rollback(before: Map<string, string | undefined>, index: Map<string, string>) {
    for (const [rel, content] of before) {
      const p = this.path(rel);
      if (content === undefined) rmSync(p, { force: true });
      else writeFileSync(p, content, "utf8");
      const entry = index.get(rel);
      await (entry
        ? this.git("update-index", "--add", "--cacheinfo", `${entry},${rel}`)
        : this.git("update-index", "--force-remove", "--", rel)
      ).catch(() => undefined);
    }
  }

  private async hasRemote() {
    const { stdout } = await this.git("remote");
    return stdout.trim().length > 0;
  }

  private git(...args: string[]) {
    return run("git", args, { cwd: this.root });
  }
}

/** YYYY-MM-DD HH:MM (Asia/Seoul) */
export function formatSeoul(d: Date): string {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return p.replace("T", " ");
}

