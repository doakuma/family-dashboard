// 노트북에 clone된 family-wiki를 다루는 WikiRepository 구현 (Node 전용).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  now?: () => Date;
  random?: () => number;
}

export class FsWikiRepository implements WikiRepository {
  private readonly root: string;
  /** 쓰기는 한 번에 하나씩 (같은 파일 동시 수정 방지) */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: FsWikiOptions) {
    this.root = resolve(opts.root);
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

  async apply(change: Change, by = this.opts.author ?? "bot"): Promise<{ commit: string } & ApplyResult> {
    const job = this.queue.then(() => this.applyNow(change, by));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async applyNow(change: Change, by: string) {
    const result = applyChange(this.files, change, this.opts.random);
    const at = formatSeoul(this.opts.now?.() ?? new Date());
    const log = this.files.read("log.md") ?? "# 변경 기록\n";
    result.files.set("log.md", `${log.replace(/\n*$/, "\n")}${formatLogLine(at, change.kind, result.summary, by, result.id)}\n`);

    for (const [rel, content] of result.files) {
      const p = this.path(rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
    }

    await this.git("add", ...result.files.keys());
    await this.git("commit", "-m", `[${change.kind}] ${result.summary}`, "--author", `${by} <bot@homesweethome.local>`);
    const { stdout } = await this.git("rev-parse", "HEAD");
    if (this.opts.push !== false && (await this.hasRemote())) await this.git("push");
    return { ...result, commit: stdout.trim() };
  }

  /** 메인 PC에서 고친 내용 반영 (1분마다) */
  async pull(): Promise<void> {
    if (await this.hasRemote()) await this.git("pull", "--rebase", "--autostash");
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

