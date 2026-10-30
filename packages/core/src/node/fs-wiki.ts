// 노트북에 clone된 family-wiki를 다루는 WikiRepository 구현 (Node 전용).
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WikiRepository } from "../ports";
import type { Change, WikiState } from "../types";
import { applyChange, formatLogLine, type ApplyResult, type WikiFiles } from "../wiki/apply";
import { readWiki } from "../wiki/read";

const run = promisify(execFile);

export interface FsWikiOptions {
  /** 위키 레포 경로 (WIKI_REPO_PATH) */
  root: string;
  /** commit 후 push할지. 원격이 없으면 건너뛴다. 기본 true */
  push?: boolean;
  /** log.md에 남길 작성자 */
  author?: string;
  /** 읽기 전용(예시 위키 등). git 루트 검사를 건너뛰고 apply를 막는다. */
  readOnly?: boolean;
  now?: () => Date;
  random?: () => number;
}

/** apply 결과: 커밋은 항상 만들어졌고, push는 실패할 수 있다(다음 apply 때 같이 올라간다). */
export interface ApplyOutcome extends ApplyResult {
  commit: string;
  /** 원격에 올렸는지. 원격이 없거나 push 옵션이 꺼져 있거나 push가 실패하면 false */
  pushed: boolean;
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
  /** 쓰기는 한 번에 하나씩 (같은 파일 동시 수정 방지) */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: FsWikiOptions) {
    this.root = resolve(opts.root);
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

  async read(): Promise<WikiState> {
    return readWiki(this.files);
  }

  async apply(change: Change, by = this.opts.author ?? "bot"): Promise<ApplyOutcome> {
    if (this.opts.readOnly) throw new Error("읽기 전용 위키에는 쓸 수 없어요");
    return this.enqueue(() => this.applyNow(change, by));
  }

  /** 메인 PC에서 고친 내용 반영 (1분마다). 쓰기와 같은 큐를 타서 apply 도중에 끼어들지 않는다. */
  async pull(): Promise<void> {
    return this.enqueue(async () => {
      if (await this.hasRemote()) await this.git("pull", "--rebase", "--autostash");
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async applyNow(change: Change, by: string): Promise<ApplyOutcome> {
    const result = applyChange(this.files, change, this.opts.random);
    const at = formatSeoul(this.opts.now?.() ?? new Date());
    const log = this.files.read("log.md") ?? "# 변경 기록\n";
    result.files.set("log.md", `${log.replace(/\n*$/, "\n")}${formatLogLine(at, change.kind, result.summary, by, result.id)}\n`);

    const rels = [...result.files.keys()];
    const before = new Map(rels.map((rel) => [rel, this.files.read(rel)]));
    let commit: string;
    try {
      for (const [rel, content] of result.files) {
        const p = this.path(rel);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content, "utf8");
      }
      await this.git("add", ...rels);
      await this.git("commit", "-m", `[${change.kind}] ${result.summary}`, "--author", `${by} <bot@homesweethome.local>`);
      commit = (await this.git("rev-parse", "HEAD")).stdout.trim();
    } catch (e) {
      await this.rollback(before);
      throw e;
    }

    let pushed = false;
    if (this.opts.push !== false) {
      try {
        if (await this.hasRemote()) {
          await this.git("push");
          pushed = true;
        }
      } catch {
        // 커밋은 이미 로컬에 있다. push는 다음 apply나 점검 때 다시 시도한다.
      }
    }
    return { ...result, commit, pushed };
  }

  /** commit까지 못 갔을 때: 스테이징을 풀고 파일을 원래대로(없던 파일은 삭제) 되돌린다. */
  private async rollback(before: Map<string, string | undefined>) {
    const rels = [...before.keys()];
    await this.git("reset", "-q", "--", ...rels).catch(() => undefined);
    for (const [rel, content] of before) {
      const p = this.path(rel);
      if (content === undefined) rmSync(p, { force: true });
      else writeFileSync(p, content, "utf8");
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

