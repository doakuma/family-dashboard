// 날짜 질문 채점(순수 함수). 실제 LLM 호출은 어댑터를 주입받는 쪽(CLI)이 정한다.
// 문항마다 now=기준일 서울 정오로 extractIntent -> answerFromQuery 경로를 탄다.
// (a) LLM 원값(qFrom/qTo/qTense/제외/키워드/구성원)  (b) 최종 답 범위·되묻기를 따로 채점한다.
import { addDays, diffDays, isDate, type Anniversary, type Event, type LlmAdapter, type Member, type Task } from "@hsh/core";
import { answerFromQuery } from "../answer/answer";
import { extractIntent } from "../intent/extract";
import { parseLlmOutput, type LlmOutput } from "../intent/prompt";
import type { ReportsUsage } from "../llm/client";
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
  /** 시간 초과(timeout/aborted)로 실패 */
  timedOut: boolean;
  /** 기준일이 바뀐 직후 첫 문항(프롬프트 앞부분이 바뀌어 Ollama 앞부분 캐시를 못 쓴다: 느린 값 해석용) */
  firstOfDay: boolean;
  numCtx?: number;
  /** 프롬프트 토큰 수(Ollama prompt_eval_count를 받았을 때만) */
  promptTokens?: number;
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
  /** 시간 초과로 실패한 문항 수 */
  timeouts: number;
  /** 시간 초과 문항을 뺀 전체 정답률(owner-check 제외) */
  scoredExTimeout: Tally;
  totalMs: number;
  /** 토큰 수를 받은 문항의 요약(어댑터가 알려 줄 때만) */
  tokens?: { count: number; max: number; avg: number; numCtx?: number; overCtx90: string[] };
  results: CaseResult[];
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
/** 느슨한 단어 비교: 받은 말이 기대 단어를 포함하거나, 기대가 받은 말을 포함하되 2자 이상이고 기대 길이의 절반 이상일 때("학원"↔"미술학원"은 통과, "학"은 실패) */
const loose = (got: string, want: string) => {
  const g = norm(got);
  const w = norm(want);
  return g.includes(w) || (w.includes(g) && g.length >= 2 && g.length * 2 >= w.length);
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const show = (v: unknown) => (v === undefined ? "없음" : typeof v === "string" ? v : JSON.stringify(v));
export const OWNER_CHECK = "owner-check";
const TIMEOUT_RE = /timeout|timed out|time out|aborted|abort|시간 초과/i;
export const isTimeout = (message?: string) => !!message && TIMEOUT_RE.test(message);

/** 서울 정오 */
export const noonSeoul = (today: string) => new Date(`${today}T03:00:00Z`);

/** (a) LLM 원값 채점 */
function scoreRaw(c: DateCase, raw: unknown): string[] {
  const parsed = parseLlmOutput(raw);
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
  // qTense "none"은 없음으로 본다. qDatePhrase는 채점하지 않는다.
  const tense = o.qTense === "none" ? undefined : o.qTense;
  if (e.tense && tense !== e.tense) diffs.push(`시제: ${e.tense} / ${show(tense)}`);
  // 기대값에 없는 필드는 "비어 있어야" 통과한다(엉뚱한 제외·구성원·키워드가 섞이면 실패). keyword는 날짜 범위가 있는 문항에서만 비어 있어야 한다.
  const kw = o.qKeyword?.trim();
  if (e.keyword) {
    if (!(kw && loose(kw, e.keyword))) diffs.push(`keyword: ${e.keyword} / ${show(o.qKeyword)}`);
  } else if (e.from && kw) diffs.push(`keyword: 없음 / ${kw}`);
  const exk = o.qExcludeKeyword?.trim();
  if (e.excludeKeyword) {
    if (!(exk && loose(exk, e.excludeKeyword))) diffs.push(`제외 keyword: ${e.excludeKeyword} / ${show(o.qExcludeKeyword)}`);
  } else if (exk) diffs.push(`제외 keyword: 없음 / ${exk}`);
  if (e.excludeDatesAny) {
    const extra = (o.qExcludeDates ?? []).filter((x) => !e.excludeDatesAny?.includes(x));
    if (extra.length) diffs.push(`제외 날짜: ${e.excludeDatesAny.join(",")}의 부분집합 또는 없음 / ${extra.join(",")}`);
  } else if (!sameSet(o.qExcludeDates ?? [], e.excludeDates ?? [])) diffs.push(`제외 날짜: ${show(e.excludeDates ?? "없음")} / ${show(o.qExcludeDates ?? "없음")}`);
  if (!sameSet(o.qMembers ?? [], e.members ?? [])) diffs.push(`구성원: ${show(e.members ?? "없음")} / ${show(o.qMembers ?? "없음")}`);
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
  let prevToday: string | undefined;
  for (const c of cases) {
    const firstOfDay = c.today !== prevToday;
    prevToday = c.today;
    const t0 = clock();
    let raw: unknown;
    let error: string | undefined;
    let promptTokens: number | undefined;
    let numCtx: number | undefined;
    // 원값을 가로채 기록한다. 호출 실패는 그 문항만 실패로 세고 계속 간다.
    const spy: LlmAdapter = {
      name: llm.name,
      async json(req) {
        try {
          raw = await llm.json(req);
          // 어댑터가 마지막 호출 정보를 알려 주면 읽는다(모르는 어댑터는 생략)
          const u = (llm as ReportsUsage).lastUsage;
          promptTokens = u?.promptTokens;
          numCtx = u?.numCtx;
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
        if (!e.clarify && a.status !== "clarify") {
          if (e.status && a.status !== e.status) finalDiffs.push(`상태: ${e.status} / ${a.status}`);
          const missing = (e.includeIds ?? []).filter((id) => !a.eventIds.includes(id));
          if (missing.length) finalDiffs.push(`있어야 할 일정: ${missing.join(",")} / 없음`);
          const present = (e.excludeIds ?? []).filter((id) => a.eventIds.includes(id));
          if (present.length) finalDiffs.push(`빠져야 할 일정: ${present.join(",")} / 답에 있음`);
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
      timedOut: isTimeout(error),
      promptTokens,
      numCtx,
      firstOfDay,
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
  const scoredExTimeout = empty();
  const ownerCheck = empty();
  const byTag: Record<string, Tally> = {};
  for (const r of results) {
    if (r.ownerCheck) {
      add(ownerCheck, r);
      continue;
    }
    add(scored, r);
    if (!r.timedOut) add(scoredExTimeout, r);
    for (const tag of r.tags) add((byTag[tag] ??= empty()), r);
  }
  const withTokens = results.filter((r) => r.promptTokens !== undefined);
  const tokenList = withTokens.map((r) => r.promptTokens ?? 0);
  const ctx = withTokens.find((r) => r.numCtx !== undefined)?.numCtx;
  const tokens = withTokens.length
    ? {
        count: withTokens.length,
        max: Math.max(...tokenList),
        avg: Math.round(tokenList.reduce((s, n) => s + n, 0) / tokenList.length),
        numCtx: ctx,
        overCtx90: ctx ? withTokens.filter((r) => (r.promptTokens ?? 0) > ctx * 0.9).map((r) => r.id) : [],
      }
    : undefined;
  return {
    llm,
    tokens,
    scored,
    ownerCheck,
    byTag,
    errors: results.filter((r) => r.error).length,
    timeouts: results.filter((r) => r.timedOut).length,
    scoredExTimeout,
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
  out.push(`시간 초과 제외: ${tallyLine(report.scoredExTimeout)}`);
  if (report.ownerCheck.total) out.push(`owner-check(오너 확인 대기, 따로 집계): ${tallyLine(report.ownerCheck)}`);
  const firstTimeouts = report.results.filter((r) => r.timedOut && r.firstOfDay).length;
  out.push(`LLM 호출 실패 ${report.errors}건 (시간 초과 ${report.timeouts}건, 그중 기준일 첫 문항 ${firstTimeouts}건) · 총 ${report.totalMs}ms · 문항당 평균 ${report.results.length ? Math.round(report.totalMs / report.results.length) : 0}ms`);
  if (report.tokens) {
    const t = report.tokens;
    out.push(`프롬프트 토큰(prompt_eval_count): ${t.count}문항 최대 ${t.max} · 평균 ${t.avg}${t.numCtx ? ` · num_ctx ${t.numCtx}` : ""}`);
    if (t.numCtx && t.overCtx90.length) out.push(`경고: num_ctx ${t.numCtx}의 90%(${Math.floor(t.numCtx * 0.9)})를 넘은 문항 ${t.overCtx90.length}건 (${t.overCtx90.join(", ")}). 앞부분이 잘렸을 수 있어요 -> OLLAMA_NUM_CTX를 늘리세요`);
  }
  out.push("", "## 태그별");
  for (const [tag, t] of Object.entries(report.byTag).sort(([a], [b]) => a.localeCompare(b))) out.push(`- ${tag}: ${tallyLine(t)}`);
  const wrong = report.results.filter((r) => !r.rawOk || !r.finalOk);
  out.push("", `## 틀린 문장 ${wrong.length}건`);
  for (const r of wrong) {
    out.push(`- [${r.id}] (${r.today}) "${r.text}"${r.ownerCheck ? " [owner-check]" : ""}${r.firstOfDay ? " [기준일 첫 문항]" : ""}${r.timedOut ? " [시간 초과]" : ""} ${r.ms}ms`);
    for (const d of r.rawDiffs) out.push(`    원값 ${d}`);
    for (const d of r.finalDiffs) out.push(`    최종 ${d}`);
  }
  out.push("", "## 문항당 ms");
  out.push("(* = 기준일이 바뀐 직후 첫 문항: 앞부분 캐시를 못 써서 느리다)");
  out.push(report.results.map((r) => `${r.id}${r.firstOfDay ? "*" : ""}:${r.ms}${r.promptTokens !== undefined ? `ms/${r.promptTokens}tok` : ""}`).join(" "));
  return out.join("\n");
}
