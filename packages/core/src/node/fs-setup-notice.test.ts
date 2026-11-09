import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FAMILY_ID } from "../types";
import { SETUP_NOTICE_LEASE_MS, SETUP_NOTICE_TTL_MS } from "../setup-notice";
import { FsSetupNoticeStore } from "./fs-setup-notice";

let dir: string;
let t: number;
const now = () => new Date(t);
const make = () => new FsSetupNoticeStore({ dir, now });
const files = () => readdirSync(join(dir, "notice")).sort();
const put = (s: FsSetupNoticeStore) => s.put(input());
const input = () => ({ familyId: DEFAULT_FAMILY_ID, completedAt: new Date(t).toISOString(), version: "abc123" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hsh-notice-"));
  t = Date.parse("2026-11-09T09:00:00Z");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FsSetupNoticeStore", () => {
  it("넣은 알림을 목록에서 읽는다(슬랙 ID 없음, 파일은 소유자만)", async () => {
    const s = make();
    const n = await s.put(input());
    expect(n.id).toMatch(/^[0-9a-f]{32}$/);
    expect(await make().list()).toEqual([n]);
    const text = readFileSync(join(dir, "notice", `${n.id}.json`), "utf8");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["completedAt", "familyId", "id", "version"]);
    if (process.platform !== "win32") expect(statSync(join(dir, "notice", `${n.id}.json`)).mode & 0o777).toBe(0o600);
    expect(files().some((f) => f.startsWith(".tmp-"))).toBe(false);
  });

  it("폴더가 없으면 빈 목록", async () => {
    expect(await make().list()).toEqual([]);
  });

  it("깨진 파일·이름이 다른 파일은 건너뛴다", async () => {
    const s = make();
    const n = await s.put(input());
    writeFileSync(join(dir, "notice", `${"a".repeat(32)}.json`), "{깨짐");
    writeFileSync(join(dir, "notice", `${"b".repeat(32)}.json`), JSON.stringify({ ...n }));
    expect(await s.list()).toEqual([n]);
  });

  it("claim은 한 번만 성공한다(저장소 4개로 12번 동시)", async () => {
    const n = await make().put(input());
    const stores = [make(), make(), make(), make()];
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => stores[i % 4]!.claim(n.id)));
    expect(results.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("없는 알림·형식이 틀린 id는 claim 실패", async () => {
    const s = make();
    expect(await s.claim("0".repeat(32))).toBeUndefined();
    expect(await s.claim("../x")).toBeUndefined();
  });

  it("claim 중에는 다시 claim되지 않고, 반납하면 다시 된다", async () => {
    const s = make();
    const n = await s.put(input());
    const token = (await s.claim(n.id))!;
    expect(await s.claim(n.id)).toBeUndefined();
    await s.release(n.id, token);
    expect(await s.claim(n.id)).toBeTypeOf("number");
    expect(await s.claim(n.id)).toBeUndefined();
    expect((await s.list()).map((x) => x.id)).toEqual([n.id]); // 처리 중에도 목록에는 있다(claim이 막는다)
  });

  it("claim한 봇이 죽어 임대 시간이 지나면 다른 곳이 이어받고, 그 전에는 못 받는다", async () => {
    const s = make();
    const n = await s.put(input());
    expect(await s.claim(n.id)).toBeTypeOf("number");
    t += SETUP_NOTICE_LEASE_MS - 1;
    expect(await make().claim(n.id)).toBeUndefined();
    t += 1;
    const racers = await Promise.all([make().claim(n.id), make().claim(n.id), make().claim(n.id)]);
    expect(racers.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it("complete 뒤에는 목록에서 사라지고 다시 claim되지 않는다(임대가 지나도)", async () => {
    const s = make();
    const n = await s.put(input());
    expect(await s.claim(n.id)).toBeTypeOf("number");
    await s.complete(n.id);
    expect(await s.list()).toEqual([]);
    t += SETUP_NOTICE_LEASE_MS * 10;
    expect(await make().claim(n.id)).toBeUndefined();
    expect(existsSync(join(dir, "notice", `${n.id}.json`))).toBe(false);
  });

  it("complete 직전에 알림을 읽어 둔 다른 봇도 claim하지 못한다", async () => {
    const a = make();
    const n = await a.put(input());
    const stale = await make().list(); // 다른 봇이 목록을 읽어 둠
    expect(await a.claim(n.id)).toBeTypeOf("number");
    await a.complete(n.id);
    expect(await make().claim(stale[0]!.id)).toBeUndefined();
  });

  it("24시간이 지난 알림은 expire가 지우고 id를 알려 준다", async () => {
    const s = make();
    const old = await s.put(input());
    t += SETUP_NOTICE_TTL_MS - 1000;
    const fresh = await s.put(input());
    expect(await s.expire()).toEqual([]);
    t += 1000;
    expect(await s.expire()).toEqual([old.id]);
    expect((await s.list()).map((n) => n.id)).toEqual([fresh.id]);
    expect(files().filter((f) => f.startsWith(old.id))).toEqual([]);
  });

  it("끝난 알림의 claim·done 찌꺼기는 한 시간 뒤 정리하고, 오래된 임시 파일도 지운다", async () => {
    const s = make();
    const n = await s.put(input());
    await s.claim(n.id);
    await s.complete(n.id);
    const tmp = join(dir, "notice", ".tmp-dead");
    writeFileSync(tmp, "x");
    const past = new Date(Date.now() - 2 * 3600_000);
    utimesSync(tmp, past, past);
    t = Date.now(); // 실제 파일 시각과 같은 기준
    expect(await s.expire()).toEqual([]);
    expect(files().some((f) => f.startsWith(n.id))).toBe(true); // 방금 끝난 것은 남겨 둔다
    for (const f of files().filter((f) => f.startsWith(n.id))) utimesSync(join(dir, "notice", f), past, past);
    await s.expire();
    expect(files()).toEqual([]);
  });

  it("release는 자기 번호만 반납한다: 임대가 지나 B가 잡은 뒤 A가 release해도 B의 claim은 유지된다", async () => {
    const s = make();
    const n = await put(s);
    const a = (await s.claim(n.id))!;
    t += SETUP_NOTICE_LEASE_MS;
    const b = (await make().claim(n.id))!;
    expect(b).toBeGreaterThan(a);
    await s.release(n.id, a); // 늦게 실패한 A
    expect(await make().claim(n.id)).toBeUndefined(); // B가 여전히 처리 중
    await s.release(n.id, b);
    expect(await make().claim(n.id)).toBe(b + 1);
  });

  it("release는 형식이 틀린 토큰·id를 무시한다", async () => {
    const s = make();
    const n = await put(s);
    const tok = (await s.claim(n.id))!;
    for (const bad of [0, -1, 1.5, Number.NaN]) await s.release(n.id, bad);
    await s.release("../x", tok);
    expect(await s.claim(n.id)).toBeUndefined();
  });

  it("만료·끝난 알림 정리 뒤에는 done까지 모두 지워진다(done은 맨 마지막에 지움)", async () => {
    const s = make();
    const n = await put(s);
    await s.claim(n.id);
    await s.complete(n.id);
    t += SETUP_NOTICE_TTL_MS + 3600_000;
    const files0 = files();
    expect(files0.some((f) => f.endsWith(".done"))).toBe(true);
    const past = new Date(Date.now() - 2 * 3600_000);
    for (const f of files0) utimesSync(join(dir, "notice", f), past, past);
    t = Date.now();
    await s.expire();
    expect(files()).toEqual([]);
  });

  it("파일 하나를 읽지 못해도(EISDIR 등) 그 파일만 건너뛰고 나머지는 나온다", async () => {
    const warn = vi.fn();
    const s = new FsSetupNoticeStore({ dir, now, warn });
    const good = await put(s);
    mkdirSync(join(dir, "notice", `${"c".repeat(32)}.json`)); // 읽으면 EISDIR
    expect((await s.list()).map((n) => n.id)).toEqual([good.id]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
