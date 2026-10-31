import { describe, expect, it } from "vitest";
import { buildAssetMap, callNames } from "./asset-map";
import type { Anniversary, Event, Member } from "./types";

const members: Member[] = [
  { id: "mom", name: "엄마", role: "guardian", color: "coral" },
  { id: "haneul", name: "하늘", role: "child", color: "blue" },
  { id: "family", name: "가족", role: "guardian", color: "gray" },
];
const ev = (id: string, date: string, title: string, m = "haneul"): Event => ({ id, date, allDay: true, title, members: [m], done: false });
const anniv: Anniversary[] = [{ monthDay: "08-15", title: "하늘 생일", member: "haneul" }];
const today = "2026-10-30"; // 금

describe("buildAssetMap", () => {
  const events = [ev("a", "2026-10-24", "미술학원"), ev("b", "2026-10-31", "미술학원"), ev("c", "2026-11-07", "미술학원"), ev("d", "2026-11-03", "치과")];
  const text = buildAssetMap({ today, members, events, anniversaries: anniv });

  it("오늘과 요일", () => expect(text).toContain("2026-10-30 (금요일)"));
  it("달력은 일요일 시작, 오늘 표시", () => {
    expect(text).toContain("- 이번 주: 일 2026-10-25, 월 2026-10-26");
    expect(text).toContain("금 2026-10-30(오늘)");
    expect(text).toContain("- 지난 주: 일 2026-10-18");
    expect(text).toContain("- 다다음 주: 일 2026-11-08");
    expect(text.match(/\(오늘\)/g)).toHaveLength(1);
  });
  it("구성원 id·이름·부르는 이름", () => {
    expect(text).toContain("- haneul: 하늘 / 하늘, 하늘이");
    expect(text).toContain("- mom: 엄마 / 엄마");
    expect(callNames("엄마")).toEqual(["엄마"]);
  });
  it("제목 → 구성원 → 날짜 → 반복 (같은 요일 2번 이상이면 매주 추정)", () => {
    expect(text).toContain("- 미술학원 → 하늘 → 2026-10-24(토), 2026-10-31(토), 2026-11-07(토) → 매주 토 추정");
    expect(text).toContain("- 치과 → 하늘 → 2026-11-03(화)");
    expect(text).not.toMatch(/치과 .*매주/);
  });
  it("기념일은 MM-DD 매년", () => expect(text).toContain("- 하늘 생일 → 하늘 → 08-15 매년"));
  it("오래 지난 일정은 날짜에서 빠지지만 반복 추정에는 쓴다", () => {
    const t = buildAssetMap({ today, members, events: [ev("a", "2026-09-05", "수영"), ev("b", "2026-09-12", "수영"), ev("c", "2026-11-07", "수영")], anniversaries: [] });
    expect(t).toContain("- 수영 → 하늘 → 2026-11-07(토) → 매주 토 추정");
  });
});

describe("길이 상한", () => {
  const many = Array.from({ length: 200 }, (_, i) => ev(`e${i}`, `2026-${String(11 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, `일정${i}`));
  const text = buildAssetMap({ today, members, events: many, anniversaries: anniv }, { maxChars: 1500 });
  it("상한을 넘지 않고, 달력·구성원은 남고, 먼 것부터 줄인다", () => {
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).toContain("## 달력");
    expect(text).toContain("- haneul: 하늘");
    expect(text).toMatch(/…외 \d+건/);
    expect(text).toContain("일정0 ");
    expect(text).not.toContain("일정199 ");
  });
  it("기본 상한은 3000자", () => {
    expect(buildAssetMap({ today, members, events: many, anniversaries: anniv }).length).toBeLessThanOrEqual(3000);
  });
  it("머리(오늘·달력·구성원)도 상한에 든다: 구성원이 아주 많으면 구성원 줄을 줄이고 달력은 남긴다", () => {
    const crowd: Member[] = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, name: `구성원${i}번`, role: "child", color: "blue" }));
    for (const maxChars of [900, 1500, 3000]) {
      const t = buildAssetMap({ today, members: crowd, events: many, anniversaries: anniv }, { maxChars });
      expect(t.length, `${maxChars}`).toBeLessThanOrEqual(maxChars);
      expect(t).toContain("## 달력");
      expect(t).toContain("(오늘)");
      expect(t).toMatch(/- …외 \d+명/);
    }
  });
  it("가족(family)에는 '가족이'를 붙이지 않는다", () => {
    const t = buildAssetMap({ today, members, events: [], anniversaries: [] });
    expect(t).toContain("- family: 가족 / 가족");
    expect(t).not.toContain("가족이");
  });
  it("같은 입력은 같은 출력", () => {
    expect(buildAssetMap({ today, members, events: many, anniversaries: anniv })).toBe(buildAssetMap({ today, members, events: many, anniversaries: anniv }));
  });
});
