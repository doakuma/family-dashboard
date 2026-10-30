import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { findRegion, regionToConfigFields } from "../regions";
import { needsSetup, type SetupInput } from "../types";
import { DEFAULT_FAMILY_ID as FID, asFamilyId } from "../types";
import { FamilyMismatchError, FsWikiRepository } from "./fs-wiki";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const setup = (): SetupInput => ({
  config: { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray", ...regionToConfigFields(findRegion("seoul-mapo")!) },
  members: [
    { id: "mom", name: "엄마", role: "guardian", color: "coral", birth: "1988-03-12" },
    { id: "haneul", name: "하늘", role: "child", color: "blue" },
  ],
  anniversaries: [{ monthDay: "03-12", title: "엄마 생일", member: "mom" }],
});

describe("FsWikiRepository.applySetup", () => {
  let remote: string;
  let root: string;
  const now = () => new Date("2026-10-30T11:00:00Z"); // 서울 20:00

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "hsh-setup-"));
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

  it("커밋 하나로 config + 구성원 + 기념일 + log를 쓰고 push, 이후 읽으면 세팅 끝", async () => {
    const repo = new FsWikiRepository({ root, now });
    const before = git(root, "rev-list", "--count", "HEAD");
    const r = await repo.applySetup(FID, setup());

    expect(Number(git(root, "rev-list", "--count", "HEAD")) - Number(before)).toBe(1);
    expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["anniversaries.md", "config.md", "log.md", "members/haneul.md", "members/mom.md"]);
    expect(git(root, "log", "-1", "--format=%s")).toBe("[setup] 가족 세팅: 햇살네 (구성원 2명, 기념일 1건)");
    expect(git(root, "log", "-1", "--format=%an")).toBe("setup");
    expect(r.version).toBe(git(root, "rev-parse", "HEAD"));
    expect(r.synced).toBe(true);
    expect(git(remote, "rev-parse", "main")).toBe(r.version);
    expect(git(root, "status", "--porcelain")).toBe("");

    const state = await repo.read(FID);
    expect(needsSetup(state)).toBe(false);
    expect(state.config).toMatchObject({ familyName: "햇살네", setupCompletedAt: "2026-10-30T20:00:00+09:00", kmaNx: 59 });
    expect(state.members.map((m) => m.id)).toEqual(["mom", "haneul", "family"]);
    expect(readFileSync(join(root, "log.md"), "utf8")).toContain("- 2026-10-30 20:00 [setup] 가족 세팅: 햇살네 (구성원 2명, 기념일 1건) (by setup)");
  });

  it("push가 없는 위키(원격 없음)는 synced:false로 성공", async () => {
    const repo = new FsWikiRepository({ root, push: false });
    expect((await repo.applySetup(FID, setup())).synced).toBe(false);
  });

  it("commit이 실패하면 파일을 모두 되돌린다 (config·구성원·기념일·log 없음, 커밋 그대로)", async () => {
    const repo = new FsWikiRepository({ root });
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const head = git(root, "rev-parse", "HEAD");

    await expect(repo.applySetup(FID, setup())).rejects.toThrow();

    for (const f of ["config.md", "anniversaries.md", "log.md", "members/mom.md", "members/haneul.md"]) expect(existsSync(join(root, f)), f).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(needsSetup(await repo.read(FID))).toBe(true);
    // 롤백 뒤 다시 시도하면 성공한다
    execFileSync("rm", [hook]);
    await expect(repo.applySetup(FID, setup())).resolves.toMatchObject({ synced: true });
  });

  it("세팅이 끝난 위키는 already_done (409), 커밋이 늘지 않는다", async () => {
    const repo = new FsWikiRepository({ root });
    await repo.applySetup(FID, setup());
    const head = git(root, "rev-parse", "HEAD");
    await expect(repo.applySetup(FID, setup())).rejects.toMatchObject({ code: "already_done" });
    await expect(repo.applySetup(FID, setup(), { overwrite: true })).rejects.toMatchObject({ code: "already_done" });
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("동시에 두 번 눌러도 한 번만 쓴다 (큐 안에서 판정)", async () => {
    const repo = new FsWikiRepository({ root });
    const results = await Promise.allSettled([repo.applySetup(FID, setup()), repo.applySetup(FID, setup())]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "already_done" });
    expect(git(root, "log", "--format=%s").split("\n").filter((l) => l.startsWith("[setup]"))).toHaveLength(1);
  });

  it("입력 검증 실패는 invalid이고 아무것도 쓰지 않는다", async () => {
    const repo = new FsWikiRepository({ root });
    const s = setup();
    s.members[1]!.id = "mom";
    await expect(repo.applySetup(FID, s)).rejects.toMatchObject({ code: "invalid" });
    expect(existsSync(join(root, "config.md"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("다른 가족 id로 부르면 FamilyMismatchError이고 아무것도 쓰지 않는다", async () => {
    const repo = new FsWikiRepository({ root, familyId: asFamilyId("kim") });
    const head = git(root, "rev-parse", "HEAD");
    await expect(repo.applySetup(asFamilyId("lee"), setup())).rejects.toBeInstanceOf(FamilyMismatchError);
    expect(existsSync(join(root, "config.md"))).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("읽기 전용 위키는 read_only", async () => {
    const repo = new FsWikiRepository({ root, readOnly: true });
    await expect(repo.applySetup(FID, setup())).rejects.toMatchObject({ code: "read_only" });
  });

  it("이전 구성원 파일이 남은 세팅 전 위키: 확인 없이는 needs_confirm, 확인하면 지우고 한 커밋", async () => {
    writeFileSync(join(root, "anniversaries.md"), "- 01-01 새해\n");
    execFileSync("mkdir", ["-p", join(root, "members")]);
    writeFileSync(join(root, "members", "old.md"), "---\nid: old\nname: 옛날\nrole: child\n---\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "stale");
    const repo = new FsWikiRepository({ root });
    const head = git(root, "rev-parse", "HEAD");

    await expect(repo.applySetup(FID, setup())).rejects.toMatchObject({ code: "needs_confirm" });
    expect(git(root, "rev-parse", "HEAD")).toBe(head);

    await repo.applySetup(FID, setup(), { overwrite: true });
    expect(existsSync(join(root, "members", "old.md"))).toBe(false);
    expect(git(root, "show", "--name-status", "--format=", "HEAD")).toContain("D\tmembers/old.md");
    expect(git(root, "rev-list", "--count", `${head}..HEAD`)).toBe("1");
    expect((await repo.read(FID)).members.map((m) => m.id)).toEqual(["mom", "haneul", "family"]);
  });

  it("지우기가 있는 커밋이 실패해도 지운 파일이 되살아난다", async () => {
    execFileSync("mkdir", ["-p", join(root, "members")]);
    writeFileSync(join(root, "members", "old.md"), "---\nid: old\nname: 옛날\nrole: child\n---\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "stale");
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const repo = new FsWikiRepository({ root });
    await expect(repo.applySetup(FID, setup(), { overwrite: true })).rejects.toThrow();
    expect(existsSync(join(root, "members", "old.md"))).toBe(true);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("사람이 stage해 둔 다른 파일은 세팅 커밋에 딸려 들어가지 않는다", async () => {
    const repo = new FsWikiRepository({ root });
    writeFileSync(join(root, "mine.md"), "내 작업\n");
    git(root, "add", "mine.md");
    await repo.applySetup(FID, setup());
    expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n")).not.toContain("mine.md");
    expect(git(root, "diff", "--cached", "--name-only")).toBe("mine.md");
  });
});
