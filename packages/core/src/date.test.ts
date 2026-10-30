import { describe, expect, it } from "vitest";
import { MONTH_MAX, MONTH_MIN, addMonths, parseMonth, ageOn, addDays, monthGrid, nextOccurrence, todayIn, weekdayKo } from "./date";

describe("date", () => {
  it("서울 기준 오늘 (UTC 15시 = 서울 다음날 0시)", () => {
    expect(todayIn(new Date("2026-10-29T14:59:00Z"))).toBe("2026-10-29");
    expect(todayIn(new Date("2026-10-29T15:00:00Z"))).toBe("2026-10-30");
  });

  it("addDays·요일", () => {
    expect(addDays("2026-10-29", 5)).toBe("2026-11-03");
    expect(weekdayKo("2026-11-03")).toBe("화");
  });

  it("달력 칸: 일요일 시작, 5~6주", () => {
    const g = monthGrid("2026-11");
    expect(g[0]).toBe("2026-11-01"); // 11/1이 일요일
    expect(g.length % 7).toBe(0);
    expect(monthGrid("2026-08").length).toBe(42); // 8/1 토요일 → 6주
  });

  it("다음 기념일·나이", () => {
    expect(nextOccurrence("11-21", "2026-10-29")).toBe("2026-11-21");
    expect(nextOccurrence("08-15", "2026-10-29")).toBe("2027-08-15");
    expect(nextOccurrence("02-29", "2026-03-01")).toBe("2027-02-28");
    expect(ageOn("2020-08-15", "2026-10-29")).toBe(6);
    expect(ageOn("2020-11-15", "2026-10-29")).toBe(5);
  });
});

describe("달 단위", () => {
  it("parseMonth: 형식과 범위를 엄격히 본다", () => {
    expect(parseMonth("2026-11")).toBe("2026-11");
    expect(parseMonth(MONTH_MIN)).toBe(MONTH_MIN);
    expect(parseMonth(MONTH_MAX)).toBe(MONTH_MAX);
    for (const bad of ["2026-13", "2026-00", "2026-1", "202611", "2026-11-01", " 2026-11", "2026-11 ", "2026/11", "1999-12", "2101-01", "", "abc", "2026-011", undefined, null, 202611]) {
      expect(parseMonth(bad), String(bad)).toBeUndefined();
    }
  });

  it("addMonths: 해를 넘나들고 범위 끝에서 멈춘다", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 0)).toBe("2026-11");
    expect(addMonths("2026-11", -23)).toBe("2024-12");
    expect(addMonths(MONTH_MIN, -1)).toBe(MONTH_MIN);
    expect(addMonths(MONTH_MAX, 1)).toBe(MONTH_MAX);
  });
});
