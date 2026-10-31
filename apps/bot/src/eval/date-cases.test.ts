import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_CASES, casesFileSchema, parseCases } from "./date-cases";
import { resolveRange } from "../answer/range";

const path = fileURLToPath(new URL("../../eval/date-questions.json", import.meta.url));
const data: unknown = JSON.parse(readFileSync(path, "utf8"));

describe("date-questions.json 형식", () => {
  const cases = parseCases(data);
  it(`${MIN_CASES}문항 이상, 날짜 유효, from<=to, id 유일 (zod)`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
  it("기준일이 여러 요일(금·토·일·월·수 포함)에 걸친다", () => {
    const dows = new Set(cases.map((c) => new Date(`${c.today}T00:00:00Z`).getUTCDay()));
    for (const d of [5, 6, 0, 1, 3]) expect(dows.has(d), `요일 ${d}`).toBe(true);
  });
  it("일요일 당일 경계 문항이 있다", () => {
    expect(cases.some((c) => new Date(`${c.today}T00:00:00Z`).getUTCDay() === 0 && c.tags.includes("sunday-exception"))).toBe(true);
  });
  it("과거형·말고·주말·연도 명시·keyword·구성원·되묻기가 모두 들어 있다", () => {
    const tags = new Set(cases.flatMap((c) => c.tags));
    for (const t of ["past", "malgo", "weekend", "explicit-year", "keyword", "member", "clarify", "too-long", "owner-check"]) expect(tags.has(t), t).toBe(true);
  });
  it("보조 해석기(range.ts)와 기대값이 같다: 기대값 표기 오류를 잡는 교차 검증 (owner-check 제외, LLM 전용 문항 제외)", () => {
    const llmOnly = new Set(["explicit-range", "exclude-date", "span-62"]);
    for (const c of cases) {
      if (c.tags.includes("owner-check") || c.tags.some((t) => llmOnly.has(t)) || !c.expect.from) continue;
      if (c.tags.includes("malgo") && c.tags.includes("exclude-keyword") && c.expect.noRange) continue;
      const r = resolveRange(c.text, c.today);
      expect(r && "from" in r ? [r.from, r.to] : r, `${c.id} ${c.today} ${c.text}`).toEqual([c.expect.from, c.expect.to ?? c.expect.from]);
    }
  });
});

describe("형식 검사가 잘못된 자료를 거른다", () => {
  const ok = { id: "x", today: "2026-10-30", text: "t", tags: [], expect: { from: "2026-10-31" } };
  const file = (c: unknown, n = MIN_CASES) => ({ cases: Array.from({ length: n }, (_, i) => ({ ...(c as object), id: `x${i}` })) });
  it("정상", () => expect(casesFileSchema.safeParse(file(ok)).success).toBe(true));
  it("60개 미만", () => expect(casesFileSchema.safeParse(file(ok, MIN_CASES - 1)).success).toBe(false));
  it("없는 날짜·거꾸로 범위·기대값 종류 중복·62일 초과", () => {
    for (const expect_ of [{ from: "2026-02-30" }, { from: "2026-11-05", to: "2026-11-01" }, { from: "2026-11-01", clarify: true }, {}, { from: "2026-01-01", to: "2026-12-31" }]) {
      expect(casesFileSchema.safeParse(file({ ...ok, expect: expect_ })).success, JSON.stringify(expect_)).toBe(false);
    }
  });
  it("기준일이 잘못되면 거른다", () => expect(casesFileSchema.safeParse(file({ ...ok, today: "2026-13-01" })).success).toBe(false));
  it("id 중복", () => expect(casesFileSchema.safeParse({ cases: Array.from({ length: MIN_CASES }, () => ok) }).success).toBe(false));
});
