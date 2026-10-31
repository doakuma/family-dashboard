import { DEFAULT_FAMILY_ID, type LlmAdapter } from "@hsh/core";
import { FsWikiRepository } from "@hsh/core/node";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCases, type DateCase } from "./date-cases";
import { formatReport, noonSeoul, runDateEval } from "./date-eval";

const cases = parseCases(JSON.parse(readFileSync(fileURLToPath(new URL("../../eval/date-questions.json", import.meta.url)), "utf8")));
const wiki = await new FsWikiRepository({
  root: fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url)),
  readOnly: true,
  familyId: DEFAULT_FAMILY_ID,
}).read(DEFAULT_FAMILY_ID);

/** 문항의 기대값에서 "정답" LLM 응답을 만든다 */
function truth(c: DateCase): Record<string, unknown> {
  const e = c.expect;
  return {
    intent: "question",
    ...(e.tense ? { qTense: e.tense } : {}),
    ...(e.from ? { qFrom: e.from, qTo: e.to ?? e.from } : {}),
    ...(e.keyword ? { qKeyword: e.keyword } : {}),
    ...(e.excludeKeyword ? { qExcludeKeyword: e.excludeKeyword } : {}),
    ...(e.excludeDates ? { qExcludeDates: e.excludeDates } : {}),
    ...(e.members ? { qMembers: e.members } : {}),
  };
}

/** (기준일, 문장) -> 응답을 돌려주는 가짜 LLM. 기준일은 시스템 프롬프트의 "오늘:" 줄에서 읽는다. */
function fakeLlm(answer: (today: string, text: string) => unknown): LlmAdapter & { calls: number } {
  const f = {
    name: "fake",
    calls: 0,
    async json({ system, user }: { system: string; user: string }) {
      f.calls++;
      const today = /- 오늘: (\d{4}-\d{2}-\d{2})/.exec(system)?.[1] ?? "";
      const out = answer(today, user);
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return f;
}
/** undefined이면 테스트를 실패시키는 가드 */
function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error("기대한 값이 없어요");
  return x;
}
const byId = (id: string) => must(cases.find((c) => c.id === id));
const byKey = new Map(cases.map((c) => [`${c.today}|${c.text}`, c]));
const correct = (today: string, text: string) => truth(must(byKey.get(`${today}|${text}`)));

describe("runDateEval (가짜 LLM, 실제 호출 없음)", () => {
  it("정답을 돌려주는 가짜 LLM은 모든 문항에서 원값·최종 모두 통과", async () => {
    const llm = fakeLlm(correct);
    const rep = await runDateEval(cases, llm, wiki);
    const wrong = rep.results.filter((r) => !r.rawOk || !r.finalOk).map((r) => `${r.id} ${r.text} ${[...r.rawDiffs, ...r.finalDiffs].join(" | ")}`);
    expect(wrong).toEqual([]);
    expect(llm.calls).toBe(cases.length);
    expect(rep.scored.rawPass).toBe(rep.scored.total);
    expect(rep.scored.finalPass).toBe(rep.scored.total);
    expect(rep.errors).toBe(0);
  });

  it("틀린 값은 항목별로 센다: 시제만 틀리면 원값 실패·최종 통과, 범위가 틀리면 둘 다 실패", async () => {
    const past = must(cases.find((c) => c.expect.tense === "past" && c.expect.from));
    const day = must(cases.find((c) => c.expect.tense === "nonpast" && c.expect.from && !c.tags.includes("owner-check")));
    const sub = [past, day];
    const rep = await runDateEval(
      sub,
      fakeLlm((today, text) => {
        const c = must(byKey.get(`${today}|${text}`));
        return c === past ? { ...truth(c), qTense: "nonpast" } : { ...truth(c), qFrom: "2026-01-01", qTo: "2026-01-01" };
      }),
      wiki,
    );
    const [a, b] = rep.results;
    expect(a).toMatchObject({ rawOk: false, finalOk: true });
    expect(a?.rawDiffs[0]).toBe("시제: past / nonpast");
    expect(b).toMatchObject({ rawOk: false, finalOk: false });
    expect(b?.rawDiffs[0]).toContain(`범위: ${day.expect.from}`);
    expect(b?.finalDiffs[0]).toContain("범위:");
    expect(rep.scored).toEqual({ total: 2, rawPass: 0, finalPass: 1 });
  });

  it("기대값에 없는 필드가 섞이면 실패한다: d011에 qExcludeDates가 섞이면 원값·최종 모두 실패", async () => {
    const c = byId("d011");
    expect(c.text).toBe("이번 주 토요일 뭐 있어?");
    const rep = await runDateEval([c], fakeLlm(() => ({ ...truth(c), qExcludeDates: ["2026-10-31"] })), wiki);
    expect(rep.results[0]?.rawOk).toBe(false);
    expect(rep.results[0]?.rawDiffs.join()).toContain("제외 날짜");
  });

  it("엉뚱한 qMembers·qExcludeKeyword·qKeyword가 와도 실패한다", async () => {
    const c = byId("d011");
    for (const extra of [{ qMembers: ["haneul"] }, { qExcludeKeyword: "치과" }, { qKeyword: "미술학원" }]) {
      const rep = await runDateEval([c], fakeLlm(() => ({ ...truth(c), ...extra })), wiki);
      expect(rep.results[0]?.rawOk, JSON.stringify(extra)).toBe(false);
    }
  });

  it("최종 채점은 상태와 포함·제외 일정도 본다: 범위가 맞아도 제외 대상이 답에 있으면 실패", async () => {
    const c = byId("d045"); // 토요일에 핼러윈 말고 뭐 있어? -> 핼러윈 파티가 빠져 empty
    expect(c.expect).toMatchObject({ status: "empty", excludeIds: ["evt-1a06"] });
    const rep = await runDateEval([c], fakeLlm(() => ({ ...truth(c), qExcludeKeyword: undefined })), wiki);
    expect(rep.results[0]).toMatchObject({ finalOk: false });
    expect(rep.results[0]?.finalDiffs.join()).toContain("빠져야 할 일정: evt-1a06");
    expect(rep.results[0]?.finalDiffs.join()).toContain("상태: empty / answered");
  });

  it("말고 앞 이름이 위키 제목 일부여도 전체여도 제외된다 (핼러윈 / 핼러윈 파티)", async () => {
    const both = cases.filter((x) => x.text.startsWith("토요일에 핼러윈") && x.text.includes("말고"));
    expect(both).toHaveLength(2);
    const rep = await runDateEval(both, fakeLlm(correct), wiki);
    expect(rep.results.every((r) => r.rawOk && r.finalOk)).toBe(true);
  });

  it("keyword 느슨한 비교: 너무 짧은 한 글자는 통과하지 못한다", async () => {
    const c = byId("d069"); // 학원 언제 가?
    const pass = async (kw: string) => (await runDateEval([c], fakeLlm(() => ({ ...truth(c), qKeyword: kw })), wiki)).results[0]?.rawOk;
    expect(await pass("미술학원")).toBe(true);
    expect(await pass("학")).toBe(false);
    expect(await pass("원")).toBe(false);
  });

  it("LLM이 범위를 안 주면 보조 해석기가 최종을 살려도 원값은 실패로 센다", async () => {
    const c = byId("d011");
    const rep = await runDateEval([c], fakeLlm(() => ({ intent: "question", qTense: "nonpast" })), wiki);
    expect(rep.results[0]).toMatchObject({ rawOk: false, finalOk: true });
  });

  it("한 문항의 LLM 호출 실패는 실패로 세고 계속 간다", async () => {
    const sub = cases.slice(0, 3);
    const rep = await runDateEval(sub, fakeLlm((t, x) => (x === sub[1]?.text ? new Error("연결 거부") : correct(t, x))), wiki);
    expect(rep.results.map((r) => r.finalOk)).toEqual([true, false, true]);
    expect(rep.errors).toBe(1);
    expect(rep.results[1]?.rawDiffs[0]).toContain("LLM 호출 실패: 연결 거부");
  });

  it("형식 오류 응답·질문이 아닌 응답도 실패로만 센다", async () => {
    const sub = cases.slice(0, 2);
    const rep = await runDateEval(sub, fakeLlm((_t, x) => (x === sub[0]?.text ? "not json" : { intent: "unknown" })), wiki);
    expect(rep.results.every((r) => !r.rawOk && !r.finalOk)).toBe(true);
  });

  it("owner-check 문항은 전체 정답률에서 빼고 따로 센다", async () => {
    const rep = await runDateEval(cases, fakeLlm((_t, _x) => ({ intent: "question" })), wiki);
    const owner = cases.filter((c) => c.tags.includes("owner-check")).length;
    expect(owner).toBeGreaterThan(0);
    expect(rep.ownerCheck.total).toBe(owner);
    expect(rep.scored.total + rep.ownerCheck.total).toBe(cases.length);
    expect(rep.byTag["owner-check"]).toBeUndefined();
  });

  it("now는 기준일 서울 정오", async () => {
    expect(noonSeoul("2026-11-01").toISOString()).toBe("2026-11-01T03:00:00.000Z");
    const seen: string[] = [];
    await runDateEval([must(cases[0])], fakeLlm((t) => (seen.push(t), { intent: "question" })), wiki);
    expect(seen).toEqual([must(cases[0]).today]);
  });

  it("문항당 ms는 주입한 시계로 잰다", async () => {
    let t = 0;
    const rep = await runDateEval(cases.slice(0, 2), fakeLlm(correct), wiki, { clock: () => (t += 5) });
    expect(rep.results.map((r) => r.ms)).toEqual([5, 5]);
    expect(rep.totalMs).toBe(10);
  });
});

describe("formatReport", () => {
  it("전체·태그별 정답률, 틀린 문장의 기대 vs 받은 값, 문항당 ms를 보여 준다", async () => {
    const sub = cases.filter((c) => !c.tags.includes("owner-check")).slice(0, 4);
    const rep = await runDateEval(sub, fakeLlm((t, x) => ({ ...correct(t, x), qFrom: "2026-01-01", qTo: "2026-01-01" })), wiki, { clock: (() => { let t = 0; return () => (t += 7); })() });
    const text = formatReport(rep);
    expect(text).toContain("# 날짜 채점 [fake]");
    expect(text).toContain("전체(owner-check 제외): 원값 0/4 (0.0%) · 최종 0/4 (0.0%)");
    expect(text).toContain("## 태그별");
    expect(text).toContain("## 틀린 문장 4건");
    expect(text).toContain(`"${sub[0]?.text}"`);
    expect(text).toMatch(/원값 범위: .* \/ 2026-01-01~2026-01-01/);
    expect(text).toContain(`${sub[0]?.id}:7`);
  });
  it("모두 맞으면 틀린 문장 0건", async () => {
    const text = formatReport(await runDateEval(cases.slice(0, 3), fakeLlm(correct), wiki));
    expect(text).toContain("## 틀린 문장 0건");
  });
});
