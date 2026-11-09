import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FAMILY_ID as FID } from "../types";
import { FsWikiRepository, WikiLockError } from "./fs-wiki";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("FsWikiRepository 프로세스 간 쓰기 잠금", () => {
  let root: string;
  let lock: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hsh-lock-"));
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    writeFileSync(join(root, "tasks.md"), "## 장보기\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "init");
    lock = join(root, ".git", "hsh-write.lock");
  });
  const repo = (o: Partial<ConstructorParameters<typeof FsWikiRepository>[0]> = {}) => new FsWikiRepository({ root, push: false, lockRetryMs: 5, warn: () => {}, ...o });

  it("저장소 두 개(별도 프로세스 흉내)가 동시에 써도 log.md 줄과 커밋이 하나도 안 사라진다", async () => {
    const a = repo();
    const b = repo();
    const jobs = Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).apply(FID, { kind: "task.add", payload: { list: "shopping", title: `물건${i}` } }));
    await Promise.all(jobs);
    const log = readFileSync(join(root, "log.md"), "utf8").split("\n").filter((l) => l.includes("[task.add]"));
    expect(log).toHaveLength(8);
    expect(readFileSync(join(root, "tasks.md"), "utf8").match(/물건\d/g)).toHaveLength(8);
    expect(Number(git(root, "rev-list", "--count", "HEAD"))).toBe(9);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(lock)).toBe(false);
  });

  it("잠금이 걸려 있으면 기다렸다가, 풀리면 쓴다", async () => {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "other", at: Date.now() }));
    const p = repo({ lockWaitMs: 5000 }).apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } });
    await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(join(root, "tasks.md"), "utf8")).not.toContain("우유");
    execFileSync("node", ["-e", `require('fs').unlinkSync(${JSON.stringify(lock)})`]);
    await p;
    expect(readFileSync(join(root, "tasks.md"), "utf8")).toContain("우유");
  });

  it("대기 상한을 넘기면 명확한 오류, 파일은 그대로, 남의 잠금은 지우지 않는다", async () => {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "other", at: Date.now() }));
    await expect(repo({ lockWaitMs: 60 }).apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } })).rejects.toBeInstanceOf(WikiLockError);
    expect(readFileSync(join(root, "tasks.md"), "utf8")).toBe("## 장보기\n");
    expect(existsSync(lock)).toBe(true);
  });

  it("오래된 잠금·죽은 프로세스의 잠금·깨진 잠금은 치우고 쓴다", async () => {
    const dead = Number(execFileSync("node", ["-e", "process.stdout.write(String(process.pid))"]).toString());
    for (const content of [JSON.stringify({ pid: process.pid, token: "x", at: Date.now() - 10 * 60_000 }), JSON.stringify({ pid: dead, token: "y", at: Date.now() }), "{깨짐"]) {
      writeFileSync(lock, content);
      await repo({ lockWaitMs: 2000 }).apply(FID, { kind: "task.add", payload: { list: "shopping", title: `t${content.length}` } });
      expect(existsSync(lock)).toBe(false);
    }
  });

  it("쓰기가 실패해도 잠금은 풀린다", async () => {
    const r = repo();
    await expect(r.apply(FID, { kind: "task.done", payload: { id: "task-ffff" } })).rejects.toThrow();
    expect(existsSync(lock)).toBe(false);
    await r.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } });
  });

  it("pull(동기화)도 같은 잠금 안에서 돈다", async () => {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "other", at: Date.now() }));
    await expect(repo({ lockWaitMs: 60 }).pull()).rejects.toBeInstanceOf(WikiLockError);
  });
});
