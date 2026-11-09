import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FAMILY_ID } from "../types";
import { SETUP_NOTICE_LEASE_MS, SETUP_NOTICE_TTL_MS } from "../setup-notice";
import { FsSetupNoticeStore } from "./fs-setup-notice";

let dir: string;
let t: number;
const now = () => new Date(t);
const make = () => new FsSetupNoticeStore({ dir, now });
const files = () => readdirSync(join(dir, "notice")).sort();
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
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("없는 알림·형식이 틀린 id는 claim 실패", async () => {
    const s = make();
    expect(await s.claim("0".repeat(32))).toBe(false);
    expect(await s.claim("../x")).toBe(false);
  });

  it("claim 중에는 다시 claim되지 않고, 반납하면 다시 된다", async () => {
    const s = make();
    const n = await s.put(input());
    expect(await s.claim(n.id)).toBe(true);
    expect(await s.claim(n.id)).toBe(false);
    await s.release(n.id);
    expect(await s.claim(n.id)).toBe(true);
    expect(await s.claim(n.id)).toBe(false);
    expect((await s.list()).map((x) => x.id)).toEqual([n.id]); // 처리 중에도 목록에는 있다(claim이 막는다)
  });

  it("claim한 봇이 죽어 임대 시간이 지나면 다른 곳이 이어받고, 그 전에는 못 받는다", async () => {
    const s = make();
    const n = await s.put(input());
    expect(await s.claim(n.id)).toBe(true);
    t += SETUP_NOTICE_LEASE_MS - 1;
    expect(await make().claim(n.id)).toBe(false);
    t += 1;
    const racers = await Promise.all([make().claim(n.id), make().claim(n.id), make().claim(n.id)]);
    expect(racers.filter(Boolean)).toHaveLength(1);
  });

  it("complete 뒤에는 목록에서 사라지고 다시 claim되지 않는다(임대가 지나도)", async () => {
    const s = make();
    const n = await s.put(input());
    expect(await s.claim(n.id)).toBe(true);
    await s.complete(n.id);
    expect(await s.list()).toEqual([]);
    t += SETUP_NOTICE_LEASE_MS * 10;
    expect(await make().claim(n.id)).toBe(false);
    expect(existsSync(join(dir, "notice", `${n.id}.json`))).toBe(false);
  });

  it("complete 직전에 알림을 읽어 둔 다른 봇도 claim하지 못한다", async () => {
    const a = make();
    const n = await a.put(input());
    const stale = await make().list(); // 다른 봇이 목록을 읽어 둠
    expect(await a.claim(n.id)).toBe(true);
    await a.complete(n.id);
    expect(await make().claim(stale[0]!.id)).toBe(false);
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
});
