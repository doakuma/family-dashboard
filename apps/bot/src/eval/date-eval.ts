// 날짜 질문 채점(순수 함수). 실제 LLM 호출은 어댑터를 주입받는 쪽(CLI)이 정한다.
// 문항마다 now=기준일 서울 정오로 extractIntent -> answerFromQuery 경로를 탄다.
// (a) LLM 원값(qFrom/qTo/qTense/제외/키워드/구성원)  (b) 최종 답 범위·되묻기를 따로 채점한다.
import { addDays, diffDays, isDate, type Anniversary, type Event, type LlmAdapter, type Member, type Task } from "@hsh/core";
import { answerFromQuery } from "../answer/answer";
import { extractIntent } from "../intent/extract";
import { llmOutputSchema, type LlmOutput } from "../intent/prompt";
import type { DateCase } from "./date-cases";

export interface EvalWiki {
  members: Member[];
  events: Event[];
  tasks: Task[];
  anniversaries: Anniversary[];
}

export interface CaseResult {
  id: string;
  today: string;
  text: string;
  tags: string[];
  ownerCheck: boolean;
  rawOk: boolean;
  finalOk: boolean;
  /** 틀린 항목: "필드: 기대 / 받음" */
  rawDiffs: string[];
  finalDiffs: string[];
  /** LLM 호출 실패 등 */
  error?: string;
  ms: number;
}

export interface Tally {
  total: number;
  rawPass: number;
  finalPass: number;
}
export interface EvalReport {
  llm: string;
  /** 오너 확인 대기(owner-check) 제외한 전체 */
  scored: Tally;
  ownerCheck: Tally;
  byTag: Record<string, Tally>;
  errors: number;
  totalMs: number;
  results: CaseResult[];
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const loose = (a: string, b: string) => norm(a).includes(norm(b)) || norm(b).includes(norm(a));
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const show = (v: unknown) => (v === undefined ? "없음" : typeof v === "string" ? v : JSON.stringify(v));
export const OWNER_CHECK = "owner-check";

/** 서울 정오 */
export const noonSeoul = (today: string) => new Date(`${today}T03:00:00Z`);

/** (a) LLM 원값 채점 */
function scoreRaw(c: DateCase, raw: unknown): string[] {
  const parsed = llmOutputSchema.safeParse(raw);
  if (!parsed.success) return ["응답 형식: 기대 스키마 / 형식 오류"];
  const o: LlmOutput = parsed.data;
  const e = c.expect;
  const diffs: string[] = [];
  const gotFrom = o.qFrom ?? o.qTo;
  const gotTo = o.qTo ?? o.qFrom;
  const gotRange = gotFrom && gotTo ? `${gotFrom}~${gotTo}` : undefined;
  if (o.intent !== "question") diffs.push(`intent: question / ${o.intent}`);
  if (e.from) {
    const want = `${e.from}~${e.to ?? e.from}`;
    if (gotRange !== want) diffs.push(`범위: ${want} / ${show(gotRange)}`);
  } else if (e.noRange) {
    if (gotRange) diffs.push(`범위: 없음 / ${gotRange}`);
  } else if (e.clarify && gotFrom && gotTo) {
    // 되물을 문항: 범위를 비우거나 62일 초과로 주어야 한다
    const tooLong = isDate(gotFrom) && isDate(gotTo) && diffDays(gotFrom, gotTo) + 1 > 62;
    if (!tooLong) diffs.push(`범위: 없음 또는 62일 초과 / ${gotRange}`);
  }
  if (e.tense && o.qTense !== e.tense) diffs.push(`시제: ${e.tense} / ${show(o.qTense)}`);
  if (e.keyword && !(o.qKeyword && loose(o.qKeyword, e.keyword))) diffs.push(`keyword: ${e.keyword} / ${show(o.qKeyword)}`);
  if (e.excludeKeyword && !(o.qExcludeKeyword && loose(o.qExcludeKeyword, e.excludeKeyword))) diffs.push(`제외 keyword: ${e.excludeKeyword} / ${show(o.qExcludeKeyword)}`);
  if (e.excludeDates && !sameSet(o.qExcludeDates ?? [], e.excludeDates)) diffs.push(`제외 날짜: ${e.excludeDates.join(",")} / ${show(o.qExcludeDates)}`);
  if (e.members && !sameSet(o.qMembers ?? [], e.members)) diffs.push(`구성원: ${e.members.join(",")} / ${show(o.qMembers)}`);
  return diffs;
}

export async function runDateEval(
  cases: DateCase[],
  llm: LlmAdapter,
  wiki: EvalWiki,
  opts: { clock?: () => number; onResult?: (r: CaseResult) => void } = {},
): Promise<EvalReport> {
  const clock = opts.clock ?? Date.now;
  const results: CaseResult[] = [];
  for (const c of cases) {
    const t0 = clock();
    let raw: unknown;
    let error: string | undefined;
    // 원값을 가로채 기록한다. 호출 실패는 그 문항만 실패로 세고 계속 간다.
    const spy: LlmAdapter = {
      name: llm.name,
      async json(req) {
        try {
          raw = await llm.json(req);
          return raw;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
    };
    const now = noonSeoul(c.today);
    const finalDiffs: string[] = [];
    let rawDiffs: string[];
    try {
      const intent = await extractIntent({ text: c.text, now, ...wiki }, spy);
      rawDiffs = error ? [`LLM 호출 실패: ${error}`] : scoreRaw(c, raw);
      if (error) finalDiffs.push(`LLM 호출 실패: ${error}`);
      else if (intent.type !== "question") finalDiffs.push(`질문으로 인식 못함: ${intent.type}`);
      else {
        const a = answerFromQuery(intent.query, { today: c.today, ...wiki });
        const e = c.expect;
        if (e.clarify) {
          if (a.status !== "clarify") finalDiffs.push(`되묻기: 되물어야 함 / ${a.status} ${show(a.range && `${a.range.from}~${a.range.to}`)}`);
        } else if (a.status === "clarify") {
          finalDiffs.push(`되묻기: ${e.from ? `${e.from}~${e.to ?? e.from}` : "되묻지 않음"} / 되물음`);
        } else if (e.from) {
          const want = `${e.from}~${e.to ?? e.from}`;
          const got = a.range ? `${a.range.from}~${a.range.to}` : undefined;
          if (got !== want) finalDiffs.push(`범위: ${want} / ${show(got)}`);
        } else if (e.noRange) {
          const want = `${c.today}~${addDays(c.today, 400)}`;
          const got = a.range ? `${a.range.from}~${a.range.to}` : undefined;
          if (got !== want) finalDiffs.push(`다가오는 목록: ${want} / ${show(got)}`);
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      rawDiffs = [`오류: ${error}`];
      finalDiffs.push(`오류: ${error}`);
    }
    const r: CaseResult = {
      id: c.id,
      today: c.today,
      text: c.text,
      tags: c.tags,
      ownerCheck: c.tags.includes(OWNER_CHECK),
      rawOk: rawDiffs.length === 0,
      finalOk: finalDiffs.length === 0,
      rawDiffs,
      finalDiffs,
      error,
      ms: clock() - t0,
    };
    results.push(r);
    opts.onResult?.(r);
  }
  return summarize(llm.name, results);
}

const empty = (): Tally => ({ total: 0, rawPass: 0, finalPass: 0 });
function add(t: Tally, r: CaseResult) {
  t.total++;
  if (r.rawOk) t.rawPass++;
  if (r.finalOk) t.finalPass++;
}

export function summarize(llm: string, results: CaseResult[]): EvalReport {
  const scored = empty();
  const ownerCheck = empty();
  const byTag: Record<string, Tally> = {};
  for (const r of results) {
    if (r.ownerCheck) {
      add(ownerCheck, r);
      continue;
    }
    add(scored, r);
    for (const tag of r.tags) add((byTag[tag] ??= empty()), r);
  }
  return {
    llm,
    scored,
    ownerCheck,
    byTag,
    errors: results.filter((r) => r.error).length,
    totalMs: results.reduce((s, r) => s + r.ms, 0),
    results,
  };
}

const pct = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "-");
const tallyLine = (t: Tally) => `원값 ${t.rawPass}/${t.total} (${pct(t.rawPass, t.total)}) · 최종 ${t.finalPass}/${t.total} (${pct(t.finalPass, t.total)})`;

export function formatReport(report: EvalReport): string {
  const out: string[] = [];
  out.push(`# 날짜 채점 [${report.llm}]`);
  out.push(`전체(owner-check 제외): ${tallyLine(report.scored)}`);
  if (report.ownerCheck.total) out.push(`owner-check(오너 확인 대기, 따로 집계): ${tallyLine(report.ownerCheck)}`);
  out.push(`LLM 호출 실패 ${report.errors}건 · 총 ${report.totalMs}ms · 문항당 평균 ${report.results.length ? Math.round(report.totalMs / report.results.length) : 0}ms`);
  out.push("", "## 태그별");
  for (const [tag, t] of Object.entries(report.byTag).sort(([a], [b]) => a.localeCompare(b))) out.push(`- ${tag}: ${tallyLine(t)}`);
  const wrong = report.results.filter((r) => !r.rawOk || !r.finalOk);
  out.push("", `## 틀린 문장 ${wrong.length}건`);
  for (const r of wrong) {
    out.push(`- [${r.id}] (${r.today}) "${r.text}"${r.ownerCheck ? " [owner-check]" : ""} ${r.ms}ms`);
    for (const d of r.rawDiffs) out.push(`    원값 ${d}`);
    for (const d of r.finalDiffs) out.push(`    최종 ${d}`);
  }
  out.push("", "## 문항당 ms");
  out.push(report.results.map((r) => `${r.id}:${r.ms}`).join(" "));
  return out.join("\n");
}
