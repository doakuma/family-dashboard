import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyMapping } from "../calendar";
import { DEFAULT_FAMILY_ID } from "../types";
import { FsCalendarMappingStore } from "./fs-calendar-mapping";

const mk = () => {
  const dir = mkdtempSync(join(tmpdir(), "hsh-cmap-"));
  return { dir, store: new FsCalendarMappingStore({ dir, familyId: DEFAULT_FAMILY_ID, now: () => new Date("2026-11-10T00:00:00Z") }), file: join(dir, "calendar-sync", `${DEFAULT_FAMILY_ID}.json`) };
};
const sample = () => ({ ...emptyMapping("fp1"), entries: { "evt-a": { googleId: "abcde12345", hash: "h", at: "2026-11-10T00:00:00Z" } } });

describe("FsCalendarMappingStore", () => {
  it("없으면 빈 결과, 쓰고 읽으면 같다(위키 밖 상태 폴더, 임시 파일은 남지 않음)", async () => {
    const { store, dir, file } = mk();
    expect(await store.read()).toEqual({});
    await store.write(sample());
    expect((await store.read()).mapping).toEqual(sample());
    expect(readdirSync(join(dir, "calendar-sync"))).toEqual([`${DEFAULT_FAMILY_ID}.json`]);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("깨진 파일(JSON 아님·형식 틀림)은 옆으로 치우고 broken으로 알린다", async () => {
    for (const bad of ["{ not json", JSON.stringify({ version: 2, calendar: "x", entries: {} }), JSON.stringify({ version: 1, calendar: "x", entries: { "bad id": {} } })]) {
      const { store, dir, file } = mk();
      await store.write(sample());
      writeFileSync(file, bad);
      expect(await store.read()).toEqual({ broken: true });
      expect(existsSync(file)).toBe(false);
      expect(readdirSync(join(dir, "calendar-sync")).some((n) => n.includes(".broken-"))).toBe(true);
      expect(await store.read()).toEqual({});
      await store.write(sample());
      expect(JSON.parse(readFileSync(file, "utf8")).calendar).toBe("fp1");
    }
  });

  it("동시에 여러 번 써도 파일은 항상 완전한 JSON이다(임시 파일 + rename)", async () => {
    const { store, file } = mk();
    const writes = Array.from({ length: 20 }, (_, i) => store.write({ ...emptyMapping(`fp${i}`), entries: sample().entries }));
    for (let i = 0; i < 10; i++) {
      if (existsSync(file)) expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
      await new Promise((r) => setTimeout(r, 1));
    }
    await Promise.all(writes);
    expect((await store.read()).mapping?.entries["evt-a"]).toBeDefined();
  });
});
