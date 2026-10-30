import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS, STALE_AFTER_MS, isNight, isStale, limit } from "./view";

describe("isNight", () => {
  it("23:00부터 05:59까지가 야간", () => {
    expect(isNight("22:59")).toBe(false);
    expect(isNight("23:00")).toBe(true);
    expect(isNight("23:59")).toBe(true);
    expect(isNight("00:00")).toBe(true);
    expect(isNight("05:59")).toBe(true);
    expect(isNight("06:00")).toBe(false);
    expect(isNight("12:00")).toBe(false);
  });
});

describe("isStale", () => {
  const updatedAt = "2026-11-03T01:00:00Z";
  const at = (ms: number) => new Date(Date.parse(updatedAt) + ms);

  it("3분 이내는 정상, 정확히 3분도 정상, 넘으면 경고", () => {
    expect(isStale({ offline: false, now: at(0), updatedAt })).toBe(false);
    expect(isStale({ offline: false, now: at(STALE_AFTER_MS), updatedAt })).toBe(false);
    expect(isStale({ offline: false, now: at(STALE_AFTER_MS + 1), updatedAt })).toBe(true);
  });

  it("폴링이 실패한 상태면 시간과 상관없이 경고", () => {
    expect(isStale({ offline: true, now: at(0), updatedAt })).toBe(true);
  });
});

describe("위젯 개수 제한", () => {
  const nums = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("상한 이하면 그대로, 넘으면 나머지는 more로", () => {
    expect(limit(nums(3), 6)).toEqual({ shown: [0, 1, 2], more: 0 });
    expect(limit(nums(6), LIMITS.agenda)).toMatchObject({ more: 0 });
    const r = limit(nums(8), LIMITS.agenda);
    expect(r.shown).toHaveLength(6);
    expect(r.more).toBe(2);
  });

  it("스펙 값: 오늘 일정 6, 체크리스트 6, 다가오는 날 5, 달력 칸 2", () => {
    expect(LIMITS).toEqual({ agenda: 6, checklist: 6, dday: 5, calendarCell: 2 });
  });
});

// ---- 명암비: 글자에 쓰는 색은 4.5:1 이상 ----
const css = readFileSync(join(import.meta.dirname, "../app/globals.css"), "utf8");
function tokens(block: string) {
  return Object.fromEntries([...block.matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const day = tokens(/:root\s*{([^}]*)}/.exec(css)?.[1] ?? "");
const night = { ...day, ...tokens(/\[data-mode="night"\]\s*{([^}]*)}/.exec(css)?.[1] ?? "") };

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe("명암비", () => {
  for (const [name, t] of [["낮", day], ["밤", night]] as const) {
    for (const fg of ["ink", "muted", "warn"] as const) {
      for (const bg of ["paper", "sheet"] as const) {
        it(`${name}: ${fg} on ${bg} >= 4.5`, () => {
          expect(ratio(t[fg] ?? "", t[bg] ?? "")).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  it("--faint는 글자 색으로 쓰지 않는다 (장식 전용)", () => {
    const dir = join(import.meta.dirname, "../components");
    const files = [dir, join(dir, "widgets")].flatMap((d) => readdirSync(d).filter((n) => n.endsWith(".css")).map((n) => join(d, n)));
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/(^|[^-])color:\s*var\(--faint\)/);
  });
});
