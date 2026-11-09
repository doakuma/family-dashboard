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

  it("주인 프로세스가 없는 잠금·깨진 잠금은 치우고 쓴다", async () => {
    const dead = Number(execFileSync("node", ["-e", "process.stdout.write(String(process.pid))"]).toString());
    for (const content of [JSON.stringify({ pid: dead, token: "y", at: Date.now() }), JSON.stringify({ pid: dead, token: "z", at: Date.now() - 99 * 60_000 }), "{깨짐"]) {
      writeFileSync(lock, content);
      await repo({ lockWaitMs: 2000 }).apply(FID, { kind: "task.add", payload: { list: "shopping", title: `t${content.length}` } });
      expect(existsSync(lock)).toBe(false);
    }
  });

  it("주인이 살아 있으면 오래돼도 치우지 않는다(경고만, 한 번)", async () => {
    const warns: string[] = [];
    const old = JSON.stringify({ pid: process.pid, token: "slow", at: Date.now() - 40 * 60_000 });
    writeFileSync(lock, old);
    const r = repo({ lockWaitMs: 80, lockStaleMs: 30 * 60_000, warn: (m) => warns.push(m) });
    await expect(r.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } })).rejects.toBeInstanceOf(WikiLockError);
    expect(readFileSync(lock, "utf8")).toBe(old);
    expect(warns.filter((w) => w.includes("살아 있어"))).toHaveLength(1);
  });

  it("WikiLockError 메시지에는 경로가 없고(로그에만), 화면용 문구다", async () => {
    const warns: string[] = [];
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "other", at: Date.now() }));
    const e = await repo({ lockWaitMs: 50, warn: (m) => warns.push(m) }).apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WikiLockError);
    expect((e as Error).message).toBe("다른 곳에서 저장 중이에요. 잠시 뒤 다시 해 주세요");
    expect((e as Error).message).not.toContain(root);
    expect(warns.join("\n")).toContain(lock);
  });

  it("push가 멈추면 제한 시간 뒤 커밋은 남기고 synced:false + syncError, 잠금은 풀린다", async () => {
    git(root, "config", "protocol.ext.allow", "always");
    git(root, "remote", "add", "origin", "ext::sleep 30");
    git(root, "config", "branch.main.remote", "origin");
    git(root, "config", "branch.main.merge", "refs/heads/main");
    const t0 = Date.now();
    const r = await repo({ push: true, gitNetworkTimeoutMs: 300 }).apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.synced).toBe(false);
    expect(r.syncError).toContain("시간 초과");
    expect(git(root, "rev-parse", "HEAD")).toBe(r.version);
    expect(readFileSync(join(root, "tasks.md"), "utf8")).toContain("우유");
    expect(existsSync(lock)).toBe(false);
  });

  it("pull이 멈추면 제한 시간 뒤 오류를 던지고 잠금은 풀린다", async () => {
    git(root, "config", "protocol.ext.allow", "always");
    git(root, "remote", "add", "origin", "ext::sleep 30");
    git(root, "config", "branch.main.remote", "origin");
    git(root, "config", "branch.main.merge", "refs/heads/main");
    await expect(repo({ gitNetworkTimeoutMs: 300 }).pull()).rejects.toThrow(/시간 초과/);
    expect(existsSync(lock)).toBe(false);
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
