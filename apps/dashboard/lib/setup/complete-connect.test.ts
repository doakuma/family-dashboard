// 마법사 완료 + 슬랙 연결: 저장소의 연결 기록에서 서버가 slackId를 member 파일에 쓴다(임시 git 위키, 실제 FsWikiRepository).
import { DEFAULT_FAMILY_ID, type SetupInput, type WikiRepository } from "@hsh/core";
import { FsConnectCodeStore, FsWikiRepository } from "@hsh/core/node";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSetup } from "./complete";

let tmp: string;
let wikiDir: string;
let store: FsConnectCodeStore;
let repo: FsWikiRepository;
const quiet = () => {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "hsh-complete-connect-"));
  wikiDir = join(tmp, "wiki");
  execFileSync("git", ["init", "-q", "-b", "main", wikiDir]);
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"]] as const) execFileSync("git", ["config", k, v], { cwd: wikiDir });
  store = new FsConnectCodeStore({ dir: join(tmp, "state") });
  repo = new FsWikiRepository({ root: wikiDir, push: false, author: "setup", warn: quiet });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const setup = (): SetupInput => ({
  config: { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray" },
  members: [
    { id: "mom", name: "엄마", role: "guardian", color: "coral" },
    { id: "haneul", name: "하늘", role: "child", color: "blue" },
  ],
  anniversaries: [],
});
const run = (raw: unknown, connect = store) => runSetup(raw, repo, DEFAULT_FAMILY_ID, quiet, quiet, connect);
const memberFile = (id: string) => readFileSync(join(wikiDir, "members", `${id}.md`), "utf8");
const issue = (memberKey: string, name: string, role: "guardian" | "child" = "guardian") => store.issue({ memberKey, name, role });

describe("runSetup + 연결 코드", () => {
  it("연결된 코드의 슬랙 ID를 member 파일에 slack:으로 쓰고, 끝나면 setup 코드를 모두 폐기한다", async () => {
    const mom = await issue("m1", "엄마");
    const sky = await issue("m2", "하늘", "child");
    await store.claim(mom.code, "U0123ABC");
    const r = await run({ setup: setup(), connectCodes: [{ memberId: "mom", memberKey: "m1", code: mom.code }] });
    expect(r).toEqual({ status: 200, body: { ok: true, synced: false } });
    expect(memberFile("mom")).toMatch(/^slack: U0123ABC$/m);
    expect(memberFile("haneul")).not.toMatch(/slack:/);
    expect(await store.states([mom.code, sky.code])).toEqual({ [mom.code]: "expired", [sky.code]: "expired" });
    expect(JSON.stringify(r.body)).not.toContain("U0123ABC");
  });

  it("두 구성원 모두 연결", async () => {
    const mom = await issue("m1", "엄마");
    const sky = await issue("m2", "하늘", "child");
    await store.claim(mom.code, "U1");
    await store.claim(sky.code, "U2");
    const r = await run({ setup: setup(), connectCodes: [{ memberId: "mom", memberKey: "m1", code: mom.code }, { memberId: "haneul", memberKey: "m2", code: sky.code }] });
    expect(r.status).toBe(200);
    expect(memberFile("mom")).toMatch(/slack: U1/);
    expect(memberFile("haneul")).toMatch(/slack: U2/);
  });

  it("코드를 받았지만 DM 전·만료·없는 코드면 그 구성원은 슬랙 ID 없이 만들고 unlinked로 알린다", async () => {
    const sky = await issue("m2", "하늘", "child"); // 아직 연결 전
    const r = await run({ setup: setup(), connectCodes: [{ memberId: "haneul", memberKey: "m2", code: sky.code }, { memberId: "mom", memberKey: "m1", code: "000000" }] });
    expect(r).toEqual({ status: 200, body: { ok: true, synced: false, unlinked: ["haneul", "mom"] } });
    expect(memberFile("haneul")).not.toMatch(/slack:/);
  });

  it("클라이언트가 보낸 slackId는 거부(422), 위키에 아무것도 쓰지 않는다", async () => {
    const s = setup();
    const forged = { ...s, members: [{ ...s.members[0]!, slackId: "UFORGED1" }, s.members[1]!] };
    const r = await run({ setup: forged });
    expect(r).toMatchObject({ status: 422, body: { ok: false, code: "invalid", issues: [{ path: "members.0.slackId" }] } });
    expect(existsSync(join(wikiDir, "members"))).toBe(false);
  });

  it("slackId가 있는 것은 연결 기록이 있어도 거부", async () => {
    const mom = await issue("m1", "엄마");
    await store.claim(mom.code, "U1");
    const s = setup();
    const r = await run({ setup: { ...s, members: [{ ...s.members[0]!, slackId: "UOTHER" }, s.members[1]!] }, connectCodes: [{ memberId: "mom", memberKey: "m1", code: mom.code }] });
    expect(r.status).toBe(422);
    expect(existsSync(join(wikiDir, "members"))).toBe(false);
  });

  it("코드가 다른 구성원(memberKey)의 것이면 422", async () => {
    const mom = await issue("m1", "엄마");
    await store.claim(mom.code, "U1");
    const r = await run({ setup: setup(), connectCodes: [{ memberId: "haneul", memberKey: "m2", code: mom.code }] });
    expect(r).toMatchObject({ status: 422, body: { issues: [{ path: "connectCodes.0.memberKey" }] } });
    expect(existsSync(join(wikiDir, "members"))).toBe(false);
  });

  it("한 슬랙 계정이 두 구성원에 들어가는 것은 422(저장소 검사를 우회한 경우의 최종 방어)", async () => {
    const a = await issue("m1", "엄마");
    const b = await issue("m2", "하늘", "child");
    const fake = { claimed: async (code: string) => ({ slackId: "USAME", record: code === a.code ? a : b }), clearScope: vi.fn() };
    const r = await run({ setup: setup(), connectCodes: [{ memberId: "mom", memberKey: "m1", code: a.code }, { memberId: "haneul", memberKey: "m2", code: b.code }] }, fake as unknown as FsConnectCodeStore);
    expect(r).toMatchObject({ status: 422, body: { issues: [{ path: "connectCodes.1.code", message: expect.stringContaining("한 구성원에만") }] } });
    expect(fake.clearScope).not.toHaveBeenCalled();
  });

  it("없는 구성원 id·같은 구성원/코드 중복·모양 오류", async () => {
    const mom = await issue("m1", "엄마");
    await store.claim(mom.code, "U1");
    const entry = { memberId: "mom", memberKey: "m1", code: mom.code };
    expect((await run({ setup: setup(), connectCodes: [{ ...entry, memberId: "nobody" }] })).status).toBe(422);
    expect((await run({ setup: setup(), connectCodes: [entry, entry] })).status).toBe(422);
    for (const bad of [{ ...entry, code: "12345" }, { ...entry, slackId: "U1" }, "x", { ...entry, memberKey: "../x" }]) expect((await run({ setup: setup(), connectCodes: [bad] })).status, JSON.stringify(bad)).toBe(400);
    expect((await run({ setup: setup(), connectCodes: "x" })).status).toBe(400);
    expect(existsSync(join(wikiDir, "members"))).toBe(false);
  });

  it("쓰기가 실패하면(이미 끝난 세팅 등) 코드를 지우지 않는다", async () => {
    const mom = await issue("m1", "엄마");
    await store.claim(mom.code, "U1");
    const failing: Pick<WikiRepository, "applySetup"> = { applySetup: async () => Promise.reject(new Error("fatal")) };
    const r = await runSetup({ setup: setup(), connectCodes: [{ memberId: "mom", memberKey: "m1", code: mom.code }] }, failing, DEFAULT_FAMILY_ID, quiet, quiet, store);
    expect(r.status).toBe(500);
    expect((await store.states([mom.code]))[mom.code]).toBe("connected");
  });

  it("연결 없이 끝내도 정상(기존 동작)이고 남은 코드는 정리된다", async () => {
    const sky = await issue("m2", "하늘", "child");
    expect((await run({ setup: setup() })).status).toBe(200);
    expect((await store.states([sky.code]))[sky.code]).toBe("expired");
  });
});

describe("연결 기록을 읽지 못할 때", () => {
  it("그 구성원만 unlinked로 두고 세팅은 성공한다(JSON 응답 유지)", async () => {
    const log = vi.fn();
    const broken = { claimed: async () => Promise.reject(new Error("EIO")), clearScope: async () => {} };
    const r = await runSetup({ setup: setup(), connectCodes: [{ memberId: "mom", memberKey: "m1", code: "123456" }] }, repo, DEFAULT_FAMILY_ID, log, quiet, broken as unknown as FsConnectCodeStore);
    expect(r).toEqual({ status: 200, body: { ok: true, synced: false, unlinked: ["mom"] } });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("EIO"));
    expect(memberFile("mom")).not.toMatch(/slack:/);
  });
});
