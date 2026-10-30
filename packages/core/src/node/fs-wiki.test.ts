import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FsWikiRepository } from "./fs-wiki";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("FsWikiRepository", () => {
  let remote: string;
  let root: string;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "hsh-wiki-"));
    remote = join(tmp, "remote.git");
    root = join(tmp, "wiki");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    execFileSync("git", ["clone", "-q", remote, root]);
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    writeFileSync(join(root, "tasks.md"), "## 장보기\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "init");
    git(root, "push", "-q", "-u", "origin", "main");
  });

  it("apply: 파일 수정 + log.md + 커밋 + push", async () => {
    const repo = new FsWikiRepository({ root, author: "U0123", now: () => new Date("2026-11-01T01:02:00Z") });
    const r = await repo.apply({ kind: "task.add", payload: { list: "shopping", title: "우유" } });

    expect(readFileSync(join(root, "tasks.md"), "utf8")).toContain(`- [ ] 우유 #${r.id}`);
    expect(readFileSync(join(root, "log.md"), "utf8")).toContain(`- 2026-11-01 10:02 [task.add] 장보기 추가: 우유 (by U0123) #${r.id}`);
    expect(git(root, "log", "-1", "--format=%s")).toBe("[task.add] 장보기 추가: 우유");
    expect(git(remote, "rev-parse", "main")).toBe(r.commit);
    expect(r.pushed).toBe(true);
  });

  it("push가 실패해도 예외 없이 커밋은 남고 pushed:false", async () => {
    const repo = new FsWikiRepository({ root });
    renameSync(remote, `${remote}.gone`);
    const r = await repo.apply({ kind: "task.add", payload: { list: "shopping", title: "두부" } });
    expect(r.pushed).toBe(false);
    expect(git(root, "log", "-1", "--format=%s")).toBe("[task.add] 장보기 추가: 두부");
    renameSync(`${remote}.gone`, remote);
    const r2 = await repo.apply({ kind: "task.add", payload: { list: "shopping", title: "콩나물" } });
    expect(r2.pushed).toBe(true);
    expect(git(remote, "rev-parse", "main")).toBe(r2.commit);
  });

  it("push 옵션을 끄면 pushed:false", async () => {
    const repo = new FsWikiRepository({ root, push: false });
    expect((await repo.apply({ kind: "task.add", payload: { list: "shopping", title: "파" } })).pushed).toBe(false);
  });

  it("commit이 실패하면 파일을 원래대로 되돌린다(새로 만든 파일은 삭제)", async () => {
    const repo = new FsWikiRepository({ root });
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const head = git(root, "rev-parse", "HEAD");
    await expect(repo.apply({ kind: "task.add", payload: { list: "shopping", title: "우유" } })).rejects.toThrow();

    expect(readFileSync(join(root, "tasks.md"), "utf8")).toBe("## 장보기\n");
    expect(existsSync(join(root, "log.md"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("pull도 쓰기 큐를 탄다: apply 사이에 끼어들어도 모두 성공", async () => {
    const repo = new FsWikiRepository({ root });
    const add = (title: string) => repo.apply({ kind: "task.add", payload: { list: "shopping", title } });
    await Promise.all([add("a"), repo.pull(), add("b"), repo.pull()]);
    expect((await repo.read()).tasks.map((t) => t.title)).toEqual(["a", "b"]);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("위키 폴더가 더 큰 git 레포 안의 하위 폴더면 거부한다", () => {
    const sub = join(root, "nested");
    mkdirSync(sub);
    expect(() => new FsWikiRepository({ root: sub })).toThrow(/루트가 아니에요/);
    expect(() => new FsWikiRepository({ root: join(root, "..") })).toThrow(/git 레포가 아니에요/);
    expect(() => new FsWikiRepository({ root: sub, readOnly: true })).not.toThrow();
  });

  it("읽기 전용이면 apply를 거부한다", async () => {
    const repo = new FsWikiRepository({ root, readOnly: true });
    await expect(repo.apply({ kind: "task.add", payload: { list: "shopping", title: "x" } })).rejects.toThrow(/읽기 전용/);
  });

  it("동시에 여러 번 써도 순서대로 커밋된다", async () => {
    const repo = new FsWikiRepository({ root });
    await Promise.all(
      ["사과", "배", "감"].map((title) => repo.apply({ kind: "task.add", payload: { list: "shopping", title } })),
    );
    const state = await repo.read();
    expect(state.tasks.map((t) => t.title)).toEqual(["사과", "배", "감"]);
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("4");
  });

  it("위키 밖 경로는 거부한다", () => {
    const repo = new FsWikiRepository({ root });
    expect(() => repo.files.read("../etc/passwd")).toThrow(/위키 밖/);
  });
});
