import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { findRegion, regionToConfigFields } from "../regions";
import { DEFAULT_FAMILY_ID as FID, asFamilyId } from "../types";
import { SettingsError } from "../wiki/settings";
import { FamilyMismatchError, FsWikiRepository } from "./fs-wiki";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const CONFIG = "---\nfamilyName: 햇살네\ntimezone: Asia/Seoul\nregion: 서울특별시 마포구\nkmaNx: 59\nkmaNy: 127\nkmaMidLandRegId: 11B00000\nkmaMidTaRegId: 11B10101\nfamilyColor: gray\nsetupCompletedAt: 2026-10-30T20:00:00+09:00\n---\n";
const MOM = "---\nid: mom\nname: 엄마\nrole: guardian\ncolor: coral\nslack: U0MOM\n---\n";
const HANEUL = "---\nid: haneul\nname: 하늘\nrole: child\ncolor: blue\nnickname: 하늘이\n---\n\n## 메모\n공룡을 좋아해요\n";

describe("FsWikiRepository.applySettings", () => {
  let remote: string;
  let root: string;
  const now = () => new Date("2026-11-09T11:00:00Z"); // 서울 20:00

  const seed = (withSetup = true) => {
    if (withSetup) {
      mkdirSync(join(root, "members"), { recursive: true });
      writeFileSync(join(root, "config.md"), CONFIG);
      writeFileSync(join(root, "members/mom.md"), MOM);
      writeFileSync(join(root, "members/haneul.md"), HANEUL);
    }
    if (!withSetup) return;
    git(root, "add", ".");
    git(root, "commit", "-qm", "seed");
    git(root, "push", "-q", "origin", "main");
  };

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "hsh-settings-"));
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

  it("색 변경: 커밋 하나(구성원 파일 + log.md), push, 다른 필드·본문 보존, 작성자", async () => {
    seed();
    const repo = new FsWikiRepository({ root, now });
    const before = git(root, "rev-list", "--count", "HEAD");
    const r = await repo.applySettings(FID, { kind: "member.color", payload: { id: "haneul", color: "green" } }, { author: "slack:U0MOM" });

    expect(Number(git(root, "rev-list", "--count", "HEAD")) - Number(before)).toBe(1);
    expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["log.md", "members/haneul.md"]);
    expect(git(root, "log", "-1", "--format=%s")).toBe("[settings] 하늘 색: 파랑 → 초록");
    expect(git(root, "log", "-1", "--format=%an")).toBe("slack:U0MOM");
    expect(readFileSync(join(root, "members/haneul.md"), "utf8")).toBe(HANEUL.replace("color: blue", "color: green"));
    expect(readFileSync(join(root, "log.md"), "utf8")).toContain("- 2026-11-09 20:00 [settings] 하늘 색: 파랑 → 초록 (by slack:U0MOM) #haneul");
    expect(r).toMatchObject({ version: git(root, "rev-parse", "HEAD"), synced: true, summary: "하늘 색: 파랑 → 초록" });
    expect(git(remote, "rev-parse", "main")).toBe(r.version);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect((await repo.read(FID)).members.find((m) => m.id === "haneul")?.color).toBe("green");
  });

  it("기본 작성자는 옵션 author(없으면 settings)", async () => {
    seed();
    await new FsWikiRepository({ root, now, author: "settings" }).applySettings(FID, { kind: "member.color", payload: { id: "mom", color: "teal" } });
    expect(git(root, "log", "-1", "--format=%an")).toBe("settings");
  });

  it("구성원 추가·슬랙 연결·해제·지역 변경", async () => {
    seed();
    const repo = new FsWikiRepository({ root, now, author: "settings" });
    await repo.applySettings(FID, { kind: "member.add", payload: { name: "Dad", role: "guardian", color: "teal" } });
    await repo.applySettings(FID, { kind: "member.slack", payload: { id: "dad", slackId: "U0DAD" } });
    await repo.applySettings(FID, { kind: "member.slack", payload: { id: "mom", slackId: null } });
    await repo.applySettings(FID, { kind: "config.region", payload: regionToConfigFields(findRegion("seoul-gangnam")!) });
    const s = await repo.read(FID);
    expect(s.members.find((m) => m.id === "dad")).toMatchObject({ name: "Dad", role: "guardian", color: "teal", slackId: "U0DAD" });
    expect(s.members.find((m) => m.id === "mom")?.slackId).toBeUndefined();
    expect(s.config).toMatchObject({ region: "서울특별시 강남구", familyName: "햇살네" });
    expect(readFileSync(join(root, "log.md"), "utf8")).not.toContain("U0DAD");
    expect(git(root, "log", "--format=%s", "-4").split("\n")).toEqual(["[settings] 지역: 서울특별시 마포구 → 서울특별시 강남구", "[settings] 엄마 슬랙: 연결 해제", "[settings] Dad 슬랙: 연결", "[settings] 구성원 추가: Dad (보호자, 청록)"]);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("검증 실패는 커밋도 파일 변경도 없다", async () => {
    seed();
    const repo = new FsWikiRepository({ root, now });
    const head = git(root, "rev-parse", "HEAD");
    await expect(repo.applySettings(FID, { kind: "member.slack", payload: { id: "haneul", slackId: "U0MOM" } })).rejects.toMatchObject({ code: "conflict" });
    await expect(repo.applySettings(FID, { kind: "member.color", payload: { id: "nobody", color: "green" } })).rejects.toMatchObject({ code: "not_found" });
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(join(root, "log.md"))).toBe(false);
  });

  it("세팅 전 위키는 needs_setup, 읽기 전용은 read_only", async () => {
    seed(false);
    await expect(new FsWikiRepository({ root }).applySettings(FID, { kind: "member.color", payload: { id: "mom", color: "green" } })).rejects.toMatchObject({ code: "needs_setup" });
    await expect(new FsWikiRepository({ root, readOnly: true }).applySettings(FID, { kind: "member.color", payload: { id: "mom", color: "green" } })).rejects.toMatchObject({ code: "read_only" });
    await expect(new FsWikiRepository({ root, readOnly: true }).applySettings(FID, { kind: "member.color", payload: { id: "mom", color: "green" } })).rejects.toBeInstanceOf(SettingsError);
  });

  it("다른 가족 id는 거부", async () => {
    seed();
    await expect(new FsWikiRepository({ root }).applySettings(asFamilyId("other"), { kind: "member.color", payload: { id: "mom", color: "teal" } })).rejects.toBeInstanceOf(FamilyMismatchError);
  });

  it("commit이 실패하면 파일을 되돌린다", async () => {
    seed();
    const repo = new FsWikiRepository({ root, now });
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const head = git(root, "rev-parse", "HEAD");
    await expect(repo.applySettings(FID, { kind: "member.color", payload: { id: "haneul", color: "green" } })).rejects.toThrow();
    expect(readFileSync(join(root, "members/haneul.md"), "utf8")).toBe(HANEUL);
    expect(existsSync(join(root, "log.md"))).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("같은 id의 구성원 추가가 동시에 와도 한 명만 된다(검사가 쓰기 큐 안에서 일어난다)", async () => {
    seed();
    const repo = new FsWikiRepository({ root, now });
    const results = await Promise.allSettled([
      repo.applySettings(FID, { kind: "member.add", payload: { name: "Dad", role: "guardian", color: "teal" } }),
      repo.applySettings(FID, { kind: "member.add", payload: { name: "Dad", role: "child", color: "pink", id: "dad" } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});
