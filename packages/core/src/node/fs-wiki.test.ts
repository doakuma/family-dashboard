import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FAMILY_ID as FID, asFamilyId } from "../types";
import { FamilyMismatchError, FsWikiRepository } from "./fs-wiki";

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
    const r = await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } });

    expect(readFileSync(join(root, "tasks.md"), "utf8")).toContain(`- [ ] 우유 #${r.id}`);
    expect(readFileSync(join(root, "log.md"), "utf8")).toContain(`- 2026-11-01 10:02 [task.add] 장보기 추가: 우유 (by U0123) #${r.id}`);
    expect(git(root, "log", "-1", "--format=%s")).toBe("[task.add] 장보기 추가: 우유");
    expect(git(remote, "rev-parse", "main")).toBe(r.version);
    expect(r.synced).toBe(true);
  });

  it("결과는 git 용어 없이 version·synced만 노출한다", async () => {
    const repo = new FsWikiRepository({ root });
    const r = await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "버터" } });
    expect(r.version).toBe(git(root, "rev-parse", "HEAD")); // 이 구현의 version은 커밋 sha
    expect(Object.keys(r)).not.toEqual(expect.arrayContaining(["commit"]));
    expect(r).not.toHaveProperty("pushed");
  });

  it("다른 가족 id로 부르면 거부한다", async () => {
    const repo = new FsWikiRepository({ root, familyId: asFamilyId("kim") });
    const other = asFamilyId("lee");
    await expect(repo.read(other)).rejects.toBeInstanceOf(FamilyMismatchError);
    await expect(repo.apply(other, { kind: "task.add", payload: { list: "shopping", title: "x" } })).rejects.toBeInstanceOf(FamilyMismatchError);
    expect((await repo.read(asFamilyId("kim"))).familyId).toBe("kim");
  });

  it("push가 실패해도 예외 없이 커밋은 남고 synced:false", async () => {
    const repo = new FsWikiRepository({ root });
    renameSync(remote, `${remote}.gone`);
    const r = await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "두부" } });
    expect(r.synced).toBe(false);
    expect(git(root, "log", "-1", "--format=%s")).toBe("[task.add] 장보기 추가: 두부");
    renameSync(`${remote}.gone`, remote);
    const r2 = await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "콩나물" } });
    expect(r2.synced).toBe(true);
    expect(git(remote, "rev-parse", "main")).toBe(r2.version);
  });

  it("push 옵션을 끄면 synced:false", async () => {
    const repo = new FsWikiRepository({ root, push: false });
    expect((await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "파" } })).synced).toBe(false);
  });

  it("commit이 실패하면 파일을 원래대로 되돌린다(새로 만든 파일은 삭제)", async () => {
    const repo = new FsWikiRepository({ root });
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const head = git(root, "rev-parse", "HEAD");
    await expect(repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } })).rejects.toThrow();

    expect(readFileSync(join(root, "tasks.md"), "utf8")).toBe("## 장보기\n");
    expect(existsSync(join(root, "log.md"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("pull도 쓰기 큐를 탄다: apply 사이에 끼어들어도 모두 성공", async () => {
    const repo = new FsWikiRepository({ root });
    const add = (title: string) => repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title } });
    await Promise.all([add("a"), repo.pull(), add("b"), repo.pull()]);
    expect((await repo.read(FID)).tasks.map((t) => t.title)).toEqual(["a", "b"]);
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
    await expect(repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "x" } })).rejects.toThrow(/읽기 전용/);
  });

  it("동시에 여러 번 써도 순서대로 커밋된다", async () => {
    const repo = new FsWikiRepository({ root });
    await Promise.all(
      ["사과", "배", "감"].map((title) => repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title } })),
    );
    const state = await repo.read(FID);
    expect(state.tasks.map((t) => t.title)).toEqual(["사과", "배", "감"]);
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("4");
  });

  it("readOnly 인스턴스는 pull도 거부한다", async () => {
    const repo = new FsWikiRepository({ root, readOnly: true });
    await expect(repo.pull()).rejects.toThrow(/읽기 전용/);
  });

  describe("메인 PC와 봇이 같은 줄을 고쳐 충돌", () => {
    let main: string; // 메인 PC의 clone
    const addApple = { kind: "task.add", payload: { list: "shopping", title: "봇이 넣은 우유" } } as const;

    /** 봇의 push가 막힌 사이(로컬 커밋만 쌓임) 메인 PC가 같은 위치를 고쳐 push한 상황을 만든다. */
    async function diverge(repo: FsWikiRepository) {
      main = join(root, "..", "main-pc");
      execFileSync("git", ["clone", "-q", remote, main]);
      git(main, "config", "user.email", "m@m");
      git(main, "config", "user.name", "m");
      renameSync(remote, `${remote}.gone`);
      await repo.apply(FID, addApple); // push 실패 -> 로컬 커밋만
      renameSync(`${remote}.gone`, remote);
      writeFileSync(join(main, "tasks.md"), "## 장보기\n- [ ] 메인 PC가 넣은 우유 #task-aaaa\n");
      git(main, "commit", "-qam", "main edit");
      git(main, "push", "-q");
    }

    it("pull 충돌: rebase를 취소하고 오류를 돌려주며 레포는 깨끗하고, 로컬 커밋은 그대로", async () => {
      const repo = new FsWikiRepository({ root, warn: () => undefined });
      await diverge(repo);
      const head = git(root, "rev-parse", "HEAD");

      await expect(repo.pull()).rejects.toThrow(/pull 실패.*rebase 취소/);

      expect(git(root, "status", "--porcelain")).toBe("");
      expect(git(root, "rev-parse", "HEAD")).toBe(head);
      expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe("main");
      expect(existsSync(join(root, ".git", "rebase-merge"))).toBe(false);
      expect(readFileSync(join(root, "tasks.md"), "utf8")).not.toContain("<<<<<<<");
      // 읽기는 계속 된다
      expect((await repo.read(FID)).tasks.map((t) => t.title)).toContain("봇이 넣은 우유");
    });

    it("충돌 뒤에도 다음 apply는 정상 커밋(push는 실패로 기록)하고, 반복 pull은 같은 오류", async () => {
      const warns: string[] = [];
      const repo = new FsWikiRepository({ root, warn: (m) => warns.push(m) });
      await diverge(repo);
      await expect(repo.pull()).rejects.toThrow(/pull 실패/);

      const r = await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "다음 일" } });
      expect(r.synced).toBe(false);
      expect(r.syncError).toMatch(/rejected|fetch first|non-fast-forward/);
      expect(warns.at(-1)).toMatch(/push 실패/);
      expect(git(root, "log", "-1", "--format=%s")).toBe("[task.add] 장보기 추가: 다음 일");
      await expect(repo.pull()).rejects.toThrow(/pull 실패/);
    });

    it("로컬에 커밋 안 한 수정(autostash)이 있어도 충돌 취소 뒤 그대로 돌아온다", async () => {
      const repo = new FsWikiRepository({ root, warn: () => undefined });
      await diverge(repo);
      writeFileSync(join(root, "notes.md"), "손으로 쓴 메모\n");
      git(root, "add", "notes.md");
      git(root, "commit", "-qm", "notes", "--no-verify");
      writeFileSync(join(root, "notes.md"), "손으로 쓴 메모\n고친 내용\n"); // 커밋 안 한 수정

      await expect(repo.pull()).rejects.toThrow(/pull 실패/);

      expect(readFileSync(join(root, "notes.md"), "utf8")).toBe("손으로 쓴 메모\n고친 내용\n");
      expect(git(root, "stash", "list")).toBe("");
      expect(git(root, "status", "--porcelain")).toBe("M notes.md");
    });
  });

  it("pull은 되지만 autostash 재적용에서 충돌하면 오류를 내고, 작업 트리는 깨끗하며 수정은 stash에 남는다", async () => {
    const repo = new FsWikiRepository({ root, warn: () => undefined });
    const main = join(root, "..", "main-pc");
    execFileSync("git", ["clone", "-q", remote, main]);
    git(main, "config", "user.email", "m@m");
    git(main, "config", "user.name", "m");
    writeFileSync(join(main, "tasks.md"), "## 장보기\n- [ ] 메인 PC 우유 #task-aaaa\n");
    git(main, "commit", "-qam", "main edit");
    git(main, "push", "-q");
    writeFileSync(join(root, "tasks.md"), "## 장보기\n- [ ] 로컬에서 손으로 쓴 우유 #task-bbbb\n"); // 커밋 안 한 같은 위치 수정

    await expect(repo.pull()).rejects.toThrow(/되살리다 충돌.*tasks\.md/);

    expect(git(root, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(root, "tasks.md"), "utf8")).not.toContain("<<<<<<<");
    expect(readFileSync(join(root, "tasks.md"), "utf8")).toContain("메인 PC 우유");
    expect(git(root, "stash", "list")).not.toBe("");
    expect(git(root, "show", "stash@{0}:tasks.md")).toContain("로컬에서 손으로 쓴 우유");
  });

  it("rebase 진행 중인 레포에는 apply·pull을 거부한다", async () => {
    const repo = new FsWikiRepository({ root });
    mkdirSync(join(root, ".git", "rebase-merge"));
    const head = git(root, "rev-parse", "HEAD");
    await expect(repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "x" } })).rejects.toThrow(/rebase 진행 중/);
    await expect(repo.pull()).rejects.toThrow(/rebase 진행 중/);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(root, "tasks.md"), "utf8")).toBe("## 장보기\n");
  });

  it("merge 진행 중이거나 detached HEAD면 apply를 거부한다", async () => {
    const repo = new FsWikiRepository({ root });
    writeFileSync(join(root, ".git", "MERGE_HEAD"), `${git(root, "rev-parse", "HEAD")}\n`);
    await expect(repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "x" } })).rejects.toThrow(/merge 진행 중/);
    rmSync(join(root, ".git", "MERGE_HEAD"));

    git(root, "checkout", "-q", "--detach");
    await expect(repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "x" } })).rejects.toThrow(/detached HEAD/);
    expect(git(root, "rev-list", "--count", "--all")).toBe("1");
  });

  it("push 실패 원인을 결과와 로그(warn)에 남긴다", async () => {
    const warns: string[] = [];
    const repo = new FsWikiRepository({ root, warn: (m) => warns.push(m) });
    renameSync(remote, `${remote}.gone`);
    const r = await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "두부" } });
    expect(r.synced).toBe(false);
    expect(r.syncError).toBeTruthy();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(r.syncError);
  });

  it("사람이 stage해 둔 다른 파일은 apply 커밋에 딸려 들어가지 않는다", async () => {
    const repo = new FsWikiRepository({ root, push: false });
    writeFileSync(join(root, "mine.md"), "내 작업\n");
    git(root, "add", "mine.md");
    await repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } });
    expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["log.md", "tasks.md"]);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("mine.md");
  });

  it("commit 실패 롤백은 사람이 stage해 둔 변경을 풀지 않는다", async () => {
    const repo = new FsWikiRepository({ root });
    writeFileSync(join(root, "mine.md"), "내 작업\n");
    writeFileSync(join(root, "tasks.md"), "## 장보기\n- [ ] 손으로 넣은 것 #task-hand\n");
    git(root, "add", "mine.md", "tasks.md"); // tasks.md도 사람이 stage해 둔 상태
    const staged = git(root, "ls-files", "-s", "tasks.md");
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    await expect(repo.apply(FID, { kind: "task.add", payload: { list: "shopping", title: "우유" } })).rejects.toThrow();

    expect(git(root, "diff", "--cached", "--name-only").split("\n").sort()).toEqual(["mine.md", "tasks.md"]);
    expect(git(root, "ls-files", "-s", "tasks.md")).toBe(staged);
    expect(readFileSync(join(root, "tasks.md"), "utf8")).toBe("## 장보기\n- [ ] 손으로 넣은 것 #task-hand\n");
    expect(existsSync(join(root, "log.md"))).toBe(false);
  });

  it("위키 밖 경로는 거부한다", () => {
    const repo = new FsWikiRepository({ root });
    expect(() => repo.files.read("../etc/passwd")).toThrow(/위키 밖/);
  });
});
