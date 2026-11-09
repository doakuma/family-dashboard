import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_CLAIM_TTL_MS, CONNECT_CODE_TTL_MS, CONNECT_MAX_ACTIVE, ConnectStoreError } from "../connect-code";
import { FsConnectCodeStore } from "./fs-connect-code";

let dir: string;
let t: number;
const now = () => new Date(t);
const make = (random?: (max: number) => number) => new FsConnectCodeStore({ dir, now, random });
const files = () => readdirSync(join(dir, "connect")).sort();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hsh-connect-"));
  t = Date.parse("2026-11-09T09:00:00Z");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sky = { memberKey: "m1", name: "하늘", role: "child" as const };
const mom = { memberKey: "m2", name: "엄마", role: "guardian" as const };

describe("발급", () => {
  it("6자리 코드·30분 만료·기록 내용, 파일은 소유자만 읽는다", async () => {
    const s = make();
    const r = await s.issue(sky);
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r).toMatchObject({ memberKey: "m1", name: "하늘", role: "child", scope: "setup", issuedAt: "2026-11-09T09:00:00.000Z" });
    expect(Date.parse(r.expiresAt) - Date.parse(r.issuedAt)).toBe(CONNECT_CODE_TTL_MS);
    expect(JSON.parse(readFileSync(join(dir, "connect", `${r.code}.json`), "utf8"))).toEqual(r);
    if (process.platform !== "win32") expect(statSync(join(dir, "connect", `${r.code}.json`)).mode & 0o777).toBe(0o600); // Windows는 모드 비트가 없다(홈 폴더 ACL에 의존)
    expect(files()).toEqual([`${r.code}.json`]); // 임시 파일이 남지 않는다
  });

  it("활성 코드끼리 겹치지 않는다(난수가 같은 값을 계속 줘도 다시 뽑는다)", async () => {
    const seq = [5, 5, 5, 6];
    const s = make(() => seq.shift() ?? 99);
    const a = await s.issue(sky);
    const b = await s.issue(mom);
    expect([a.code, b.code]).toEqual(["000005", "000006"]);
  });

  it("두 프로세스(저장소 두 개)가 같은 난수를 뽑아도 배타 생성이라 겹치지 않는다", async () => {
    const a = make(() => 123);
    const b = make((() => { let n = 123; return () => n++; })());
    const [x, y] = await Promise.all([a.issue(sky), b.issue(mom)]);
    expect(x.code).not.toBe(y.code);
  });

  it("같은 구성원이 다시 받으면 이전 코드(와 연결 기록)는 무효", async () => {
    const s = make();
    const first = await s.issue(sky);
    expect((await s.claim(first.code, "U1")).ok).toBe(true);
    const second = await s.issue(sky);
    expect(second.code).not.toBe(first.code);
    expect(await s.states([first.code, second.code])).toEqual({ [first.code]: "expired", [second.code]: "pending" });
    expect(await s.claimed(first.code)).toBeUndefined();
    expect(await s.claim(first.code, "U2")).toEqual({ ok: false, reason: "invalid" });
    expect(files()).toEqual([`${second.code}.json`]);
  });

  it("다른 구성원의 코드는 그대로", async () => {
    const s = make();
    const a = await s.issue(sky);
    const b = await s.issue(mom);
    expect(await s.states([a.code, b.code])).toEqual({ [a.code]: "pending", [b.code]: "pending" });
  });

  it("활성 코드가 상한을 넘으면 too_many(같은 구성원 재발급은 계속 된다)", async () => {
    const s = make();
    for (let i = 0; i < CONNECT_MAX_ACTIVE; i++) await s.issue({ ...sky, memberKey: `k${i}` });
    await expect(s.issue({ ...sky, memberKey: "extra" })).rejects.toBeInstanceOf(ConnectStoreError);
    await expect(s.issue({ ...sky, memberKey: "k0" })).resolves.toMatchObject({ memberKey: "k0" });
  });

  it("발급할 때 만료·깨진 파일을 정리한다", async () => {
    const s = make();
    const old = await s.issue(sky);
    writeFileSync(join(dir, "connect", "999999.json"), "{not json");
    writeFileSync(join(dir, "connect", "888888.claim.json"), JSON.stringify({ slackId: "U1", claimedAt: "2026-11-09T09:00:00Z" })); // 짝 없는 연결 기록
    t += CONNECT_CODE_TTL_MS;
    const fresh = await s.issue(mom);
    expect(files()).toEqual([`${fresh.code}.json`]);
    expect((await s.states([old.code]))[old.code]).toBe("expired");
  });
});

describe("claim", () => {
  it("성공하면 connected, slackId는 claimed()로만 나온다(states에는 없다)", async () => {
    const s = make();
    const r = await s.issue(sky);
    expect(await s.states([r.code])).toEqual({ [r.code]: "pending" });
    expect(await s.claim(r.code, "U0123ABC")).toMatchObject({ ok: true, record: { name: "하늘" } });
    const st = await s.states([r.code]);
    expect(st).toEqual({ [r.code]: "connected" });
    expect(JSON.stringify(st)).not.toContain("U0123ABC");
    expect(await s.claimed(r.code)).toMatchObject({ slackId: "U0123ABC", record: { memberKey: "m1" } });
  });

  it("한 코드는 한 번만: 같은 계정이 또 보내면 already_yours, 다른 계정은 invalid", async () => {
    const s = make();
    const r = await s.issue(sky);
    await s.claim(r.code, "U1");
    expect(await s.claim(r.code, "U1")).toEqual({ ok: false, reason: "already_yours", name: "하늘", scope: "setup" });
    expect(await s.claim(r.code, "U2")).toEqual({ ok: false, reason: "invalid" });
    expect((await s.claimed(r.code))?.slackId).toBe("U1");
  });

  it("동시에 여러 번(여러 프로세스) 보내도 하나만 성공한다", async () => {
    const stores = [make(), make(), make(), make()];
    const r = await stores[0]!.issue(sky);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => stores[i % 4]!.claim(r.code, `U${i}`)));
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const winner = (await stores[0]!.claimed(r.code))?.slackId;
    expect(winner).toMatch(/^U\d+$/);
    expect(files()).toEqual([`${r.code}.claim.json`, `${r.code}.json`].sort());
  });

  it("없는 코드·형식 오류·만료는 모두 invalid(구분하지 않는다)", async () => {
    const s = make();
    const r = await s.issue(sky);
    for (const bad of ["000000", "12345", "abcdef", "", "../../x"]) expect(await s.claim(bad, "U1"), bad).toEqual({ ok: false, reason: "invalid" });
    t += CONNECT_CODE_TTL_MS;
    expect(await s.claim(r.code, "U1")).toEqual({ ok: false, reason: "invalid" });
    expect(await s.claim((await s.issue(sky)).code, "bad id!")).toEqual({ ok: false, reason: "invalid" });
  });

  it("만료 직전은 성공", async () => {
    const s = make();
    const r = await s.issue(sky);
    t += CONNECT_CODE_TTL_MS - 1;
    expect((await s.claim(r.code, "U1")).ok).toBe(true);
  });

  it("연결된 코드는 만료돼도 마법사 완료까지 남고(24시간), 그 뒤 사라진다", async () => {
    const s = make();
    const r = await s.issue(sky);
    await s.claim(r.code, "U1");
    t += CONNECT_CODE_TTL_MS * 2;
    expect((await s.states([r.code]))[r.code]).toBe("connected");
    expect(await s.claimed(r.code)).toBeDefined();
    t += CONNECT_CLAIM_TTL_MS;
    expect((await s.states([r.code]))[r.code]).toBe("expired");
    expect(await s.claimed(r.code)).toBeUndefined();
  });

  it("같은 슬랙 계정이 다른 구성원 코드를 쓰면 slack_taken + 먼저 연결된 이름", async () => {
    const s = make();
    const a = await s.issue(sky);
    const b = await s.issue(mom);
    await s.claim(a.code, "U1");
    expect(await s.claim(b.code, "U1")).toEqual({ ok: false, reason: "slack_taken", name: "하늘", scope: "setup" });
    expect((await s.states([b.code]))[b.code]).toBe("pending"); // 코드는 소모되지 않는다
    expect((await s.claim(b.code, "U2")).ok).toBe(true);
  });

  it("다시 받은 코드로는 같은 계정이 다시 연결할 수 있다(이전 연결은 지워졌으므로)", async () => {
    const s = make();
    const a = await s.issue(sky);
    await s.claim(a.code, "U1");
    const b = await s.issue(sky);
    expect((await s.claim(b.code, "U1")).ok).toBe(true);
  });
});

describe("정리·경쟁", () => {
  it("오래된 .tmp-* 파일은 지우고 방금 만든 것은 둔다", async () => {
    const s = make();
    await s.issue(sky);
    const old = join(dir, "connect", ".tmp-old");
    const fresh = join(dir, "connect", ".tmp-fresh");
    writeFileSync(old, "x");
    writeFileSync(fresh, "x");
    const longAgo = new Date(Date.now() - 10 * 60_000); // 임시 파일 나이는 실제 시계(mtime) 기준
    utimesSync(old, longAgo, longAgo);
    utimesSync(fresh, new Date(), new Date());
    await s.issue(mom);
    expect(files()).not.toContain(".tmp-old");
    expect(files()).toContain(".tmp-fresh");
  });

  it("정리하다 읽거나 지우지 못하는 항목이 있어도 로그만 남기고 발급·claim은 된다", async () => {
    const warn = vi.fn();
    const s = new FsConnectCodeStore({ dir, now, warn });
    const a = await s.issue(sky);
    mkdirSync(join(dir, "connect", "777777.claim.json")); // 파일이 아니라 폴더: 읽기 실패
    const b = await s.issue(mom);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("777777"));
    expect((await s.claim(a.code, "U1")).ok).toBe(true);
    expect(b.code).toMatch(/^\d{6}$/);
  });

  it("claim 도중 같은 구성원이 재발급해 기록이 바뀌면 연결은 실패로 끝나고 연결 기록이 남지 않는다", async () => {
    const s = make();
    const r = await s.issue(sky);
    // claim이 연결 기록을 만든 직후(재확인 전)에 재발급이 끼어든 상황을 만든다
    const other = make();
    const real = (s as unknown as { createExclusive: (p: string, d: unknown) => Promise<boolean> }).createExclusive.bind(s);
    (s as unknown as { createExclusive: unknown }).createExclusive = async (p: string, d: unknown) => {
      const made = await real(p, d);
      if (p.endsWith(".claim.json")) await other.issue(sky);
      return made;
    };
    expect(await s.claim(r.code, "U1")).toEqual({ ok: false, reason: "invalid" });
    expect(await s.claimed(r.code)).toBeUndefined();
    expect(files().filter((f) => f.endsWith(".claim.json"))).toEqual([]);
  });
});

describe("revoke · clearScope", () => {
  it("unclaimedOnly: 연결 전 코드만 지우고 이미 연결된 코드는 그대로", async () => {
    const s = make();
    const a = await s.issue(sky);
    const b = await s.issue(mom);
    await s.claim(a.code, "U1");
    await s.revoke(a.code, { unclaimedOnly: true });
    await s.revoke(b.code, { unclaimedOnly: true });
    expect(await s.states([a.code, b.code])).toEqual({ [a.code]: "connected", [b.code]: "expired" });
    await s.revoke(a.code); // 옵션 없이는 연결된 코드도 지운다(마법사가 코드를 버릴 때)
    expect((await s.states([a.code]))[a.code]).toBe("expired");
  });

  it("revoke는 코드를 못 쓰게 하고, 없는 코드·잘못된 값은 오류 없이 넘어간다", async () => {
    const s = make();
    const r = await s.issue(sky);
    await s.revoke(r.code);
    await s.revoke(r.code);
    await s.revoke("../../etc/passwd");
    expect(await s.claim(r.code, "U1")).toEqual({ ok: false, reason: "invalid" });
    expect(files()).toEqual([]);
  });

  it("clearScope는 setup 범위 코드와 연결 기록을 전부 지운다", async () => {
    const s = make();
    const a = await s.issue(sky);
    await s.issue(mom);
    await s.claim(a.code, "U1");
    await s.clearScope("setup");
    expect(files()).toEqual([]);
  });

  it("폴더가 아직 없어도 조회·정리는 오류 없이", async () => {
    const s = make();
    expect(await s.states(["123456", "x"])).toEqual({ "123456": "expired", x: "expired" });
    await s.clearScope("setup");
    await s.revoke("123456");
    expect(await s.claimed("123456")).toBeUndefined();
  });
});

describe("settings 범위 (#22: 세팅 뒤 재연결)", () => {
  const skySettings = { memberKey: "haneul", name: "하늘", role: "child" as const, scope: "settings" as const };

  it("settings 코드를 발급·claim·조회하고 기록에 범위가 남는다", async () => {
    const s = make();
    const r = await s.issue(skySettings);
    expect(r.scope).toBe("settings");
    expect((await s.states([r.code]))[r.code]).toBe("pending");
    expect(await s.claim(r.code, "U0SKY")).toMatchObject({ ok: true });
    expect((await s.states([r.code]))[r.code]).toBe("connected");
    expect(await s.claimed(r.code)).toMatchObject({ slackId: "U0SKY", record: { scope: "settings", memberKey: "haneul" } });
  });

  it("범위가 다르면 같은 memberKey여도 서로의 코드를 무효로 하지 않는다", async () => {
    const s = make();
    const a = await s.issue({ ...sky, memberKey: "haneul" });
    const b = await s.issue(skySettings);
    expect((await s.states([a.code, b.code]))[a.code]).toBe("pending");
    expect((await s.states([a.code, b.code]))[b.code]).toBe("pending");
  });

  it("clearScope는 그 범위만 지운다", async () => {
    const s = make();
    const a = await s.issue(sky);
    const b = await s.issue(skySettings);
    await s.clearScope("setup");
    const st = await s.states([a.code, b.code]);
    expect(st[a.code]).toBe("expired");
    expect(st[b.code]).toBe("pending");
  });

  it("같은 슬랙 계정 중복 검사는 같은 범위 안에서만", async () => {
    const s = make();
    const a = await s.issue(sky);
    expect(await s.claim(a.code, "U0X")).toMatchObject({ ok: true });
    const b = await s.issue({ ...mom, scope: "settings" });
    expect(await s.claim(b.code, "U0X")).toMatchObject({ ok: true });
  });
});
