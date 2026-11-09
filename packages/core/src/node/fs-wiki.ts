// 노트북에 clone된 family-wiki를 다루는 WikiRepository 구현 (Node 전용).
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WikiRepository, WriteResult } from "../ports";
import { DEFAULT_FAMILY_ID, type Change, type FamilyId, type SettingsChange, type SetupInput, type WikiState } from "../types";
import { applyChange, formatLogLine, type ApplyResult, type WikiFiles } from "../wiki/apply";
import { readWiki } from "../wiki/read";
import { SettingsError, buildSettingsFiles } from "../wiki/settings";
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
  /** 프로세스 간 쓰기 잠금을 기다리는 최대 시간(ms). 기본 30초. 넘으면 WikiLockError */
  lockWaitMs?: number;
  /** 이 시간보다 오래된 잠금은 죽은 프로세스가 남긴 것으로 보고 치운다(ms). 기본 5분 */
  lockStaleMs?: number;
  /** 잠금 재시도 간격(ms). 기본 50 */
  lockRetryMs?: number;
}

/** 다른 프로세스(대시보드·봇)가 쓰는 중이라 제때 쓰기 잠금을 얻지 못했다 */
export class WikiLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikiLockError";
  }
}

const LOCK_NAME = "hsh-write.lock";
const isErr = (e: unknown, ...codes: string[]) => codes.includes((e as NodeJS.ErrnoException | undefined)?.code ?? "");
const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !isErr(e, "ESRCH");
  }
};

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

/** applySettings 결과: 쓰기 결과와 요약 */
export type SettingsOutcome = SetupOutcome;

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
    // 프로세스 안은 큐로, 프로세스 사이(대시보드·봇이 같은 위키 폴더에 씀)는 파일 잠금으로 한 번에 하나만 쓴다
    const run = this.queue.then(() => this.withLock(job));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * 프로세스 간 배타 잠금(.git/hsh-write.lock). 임시 파일에 {pid, token, at}을 쓰고 link(2)로 만들어 배타 생성한다(0007과 같은 방식).
   * 기다리다 상한을 넘으면 WikiLockError. 오래됐거나 주인 프로세스가 없는 잠금은 치운다. 풀 때는 내 token일 때만 지운다.
   */
  private async withLock<T>(job: () => Promise<T>): Promise<T> {
    const lock = this.gitPath(LOCK_NAME);
    const token = randomBytes(8).toString("hex");
    const wait = this.opts.lockWaitMs ?? 30_000;
    const stale = this.opts.lockStaleMs ?? 300_000;
    const retry = this.opts.lockRetryMs ?? 50;
    const until = Date.now() + wait;
    for (;;) {
      if (await this.tryLock(lock, token)) break;
      await this.clearStale(lock, stale);
      if (Date.now() >= until) throw new WikiLockError(`다른 프로세스가 위키에 쓰는 중이라 ${Math.round(wait / 1000)}초 기다렸지만 잠금을 얻지 못했어요. 잠시 뒤 다시 해 주세요 (${lock})`);
      await new Promise((r) => setTimeout(r, retry));
    }
    try {
      return await job();
    } finally {
      const cur = await this.readLock(lock);
      if (cur?.token === token) await unlink(lock).catch(() => {});
    }
  }

  private async tryLock(lock: string, token: string): Promise<boolean> {
    const tmp = `${lock}.${process.pid}.${token}.tmp`;
    await writeFile(tmp, JSON.stringify({ pid: process.pid, token, at: Date.now() }), { flag: "wx", mode: 0o600 });
    try {
      try {
        await link(tmp, lock);
      } catch (e) {
        // Windows(NTFS)에서 백신·인덱서가 잠시 잡으면 EPERM/EBUSY: 한 번 다시
        if (!isErr(e, "EPERM", "EBUSY")) throw e;
        await new Promise((r) => setTimeout(r, 50));
        await link(tmp, lock);
      }
      return true;
    } catch (e) {
      if (isErr(e, "EEXIST", "EPERM", "EBUSY")) return false;
      throw e;
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  private async readLock(lock: string): Promise<{ pid?: number; token?: string; at?: number } | undefined> {
    try {
      const v: unknown = JSON.parse(await readFile(lock, "utf8"));
      return typeof v === "object" && v !== null ? (v as { pid?: number; token?: string; at?: number }) : {};
    } catch (e) {
      return isErr(e, "ENOENT") ? undefined : {}; // 깨진 내용은 주인을 모르는 잠금
    }
  }

  /** 시각이 오래됐거나(주인을 알 수 없는 깨진 잠금 포함) 같은 기계의 주인 프로세스가 없으면 치운다. 지우기 직전에 다시 읽어 같은 잠금일 때만 */
  private async clearStale(lock: string, staleMs: number): Promise<void> {
    const first = await this.readLock(lock);
    if (!first) return;
    const old = typeof first.at !== "number" || Date.now() - first.at > staleMs;
    const dead = typeof first.pid === "number" && !pidAlive(first.pid);
    if (!old && !dead) return;
    const again = await this.readLock(lock);
    if (again?.token !== first.token) return;
    (this.opts.warn ?? console.warn)(`[wiki] 오래된 쓰기 잠금을 치웠어요(pid ${first.pid ?? "?"})`);
    await unlink(lock).catch(() => {});
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

  /** 세팅 뒤 설정 변경(WikiRepository.applySettings). 쓰기 큐 안에서 검증·계산하고 커밋 하나로 쓴다. */
  async applySettings(familyId: FamilyId, change: SettingsChange, opts: { author?: string } = {}): Promise<SettingsOutcome> {
    this.assertFamily(familyId);
    if (this.opts.readOnly) throw new SettingsError("읽기 전용 위키에는 쓸 수 없어요", "read_only");
    const by = opts.author ?? this.opts.author ?? "settings";
    return this.enqueue(async () => {
      await this.assertReady();
      const built = buildSettingsFiles(this.files, change);
      const files = new Map<string, string | null>(built.files);
      const log = this.files.read("log.md") ?? "# 변경 기록\n";
      files.set("log.md", `${log.replace(/\n*$/, "\n")}${formatLogLine(formatSeoul(this.opts.now?.() ?? new Date()), "settings", built.summary, by, built.id)}\n`);
      return this.commitFiles(files, `[settings] ${built.summary}`, by, { summary: built.summary });
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

