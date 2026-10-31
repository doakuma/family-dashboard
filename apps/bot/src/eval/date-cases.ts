// 날짜 질문 모음의 형식. 데이터는 apps/bot/eval/date-questions.json. 순수 모듈(파일은 읽지 않는다).
import { diffDays, isDate } from "@hsh/core";
import { z } from "zod";

const date = z.string().refine((d) => isDate(d), "YYYY-MM-DD 형식의 실제 날짜가 아니에요");

export const expectSchema = z
  .object({
    /** 최종 답 범위. to를 생략하면 하루 */
    from: date.optional(),
    to: date.optional(),
    /** 되물어야 함(떨어진 날짜·62일 초과·날짜 없음) */
    clarify: z.boolean().optional(),
    /** 날짜 범위 없이 일정 이름 등으로 답함(되묻지 않음) */
    noRange: z.boolean().optional(),
    tense: z.enum(["past", "nonpast"]).optional(),
    keyword: z.string().optional(),
    excludeKeyword: z.string().optional(),
    excludeDates: z.array(date).optional(),
    /** 제외 날짜가 "A 말고 B"의 A가 기간일 때: 이 집합의 부분집합이면(비어 있어도) 통과 */
    excludeDatesAny: z.array(date).optional(),
    /** 최종 답의 상태(answered = 항목 있음, empty = 범위는 읽었으나 위키에 없음) */
    status: z.enum(["answered", "empty"]).optional(),
    /** 최종 답에 있어야 하는 일정 id (fixtures/sample-wiki) */
    includeIds: z.array(z.string()).optional(),
    /** 최종 답에 없어야 하는 일정 id (제외 대상) */
    excludeIds: z.array(z.string()).optional(),
    /** 실제 구성원 id (fixtures/sample-wiki: mom, dad, haneul, bada) */
    members: z.array(z.string()).optional(),
  })
  .superRefine((e, ctx) => {
    const kinds = [e.from !== undefined, e.clarify === true, e.noRange === true].filter(Boolean).length;
    if (kinds !== 1) ctx.addIssue({ code: "custom", message: "from / clarify / noRange 중 정확히 하나" });
    if (e.to && !e.from) ctx.addIssue({ code: "custom", message: "to만 있고 from이 없어요" });
    if (e.from && e.to && e.from > e.to) ctx.addIssue({ code: "custom", message: "from이 to보다 늦어요" });
    if (e.from && diffDays(e.from, e.to ?? e.from) + 1 > 62) ctx.addIssue({ code: "custom", message: "정답 범위는 62일 이내(넘으면 clarify)" });
  });

export const caseSchema = z.object({
  id: z.string().min(1),
  /** 기준일(서울). 채점은 이 날 정오를 now로 쓴다 */
  today: date,
  text: z.string().min(1),
  /** "owner-check"가 있으면 오너 확인 대기 항목: 전체 정답률에서 빼고 따로 센다 */
  tags: z.array(z.string()),
  expect: expectSchema,
});

export const MIN_CASES = 60;
export const casesFileSchema = z
  .object({ description: z.string().optional(), cases: z.array(caseSchema) })
  .superRefine((f, ctx) => {
    if (f.cases.length < MIN_CASES) ctx.addIssue({ code: "custom", message: `문항이 ${MIN_CASES}개 이상이어야 해요 (${f.cases.length}개)` });
    const ids = f.cases.map((c) => c.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "id가 겹쳐요" });
  });

export type DateCase = z.infer<typeof caseSchema>;
export type DateExpect = z.infer<typeof expectSchema>;

export function parseCases(json: unknown): DateCase[] {
  return casesFileSchema.parse(json).cases;
}
