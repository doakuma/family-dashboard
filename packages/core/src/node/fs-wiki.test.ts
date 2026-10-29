import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
