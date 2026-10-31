// 질문 응답. 날짜·시제·"말고" 판단은 LLM이 하고(MVP 스펙 rev 63), 코드는 검증만 한다(날짜 형식, 범위 길이, 실제 구성원 id).
// 답 문장은 여기서 위키 항목으로 결정적으로 만든다. 정규식 해석기(range.ts)는 LLM 범위가 없거나 형식이 틀릴 때만 보조로 쓴다.
// 위키는 읽기만 한다(WikiRepository 중 read만 받는다). 슬랙·환경 변수에 의존하지 않는다.
import {
  addDays,
  diffDays,
  isDate,
  nextOccurrence,
  todayIn,
  type Anniversary,
  type Event,
  type FamilyId,
  type LlmAdapter,
  type Member,
  type Task,
  type WikiRepository,
} from "@hsh/core";
import { formatDay, formatWhen } from "../format";
import { extractIntent, type Intent, type QuestionKind, type QuestionQuery } from "../intent/extract";
import { MAX_SPAN_DAYS, resolveRange, type DateRange } from "./range";

export interface AnswerContext {
  today: string;
  members: Member[];
  events: Event[];
  tasks: Task[];
  anniversaries: Anniversary[];
}

export interface Answered {
  /** answered = 항목이 있음, empty = 범위는 읽었고 위키에 없음, clarify = 되물음(범위를 모르거나 LLM 실패) */
  status: "answered" | "empty" | "clarify";
  /** 슬랙에 그대로 붙일 문장 */
  text: string;
  range?: DateRange;
  /** 답에 쓴 위키 항목(검증·로그용) */
  eventIds: string[];
  anniversaries: string[];
  taskIds: string[];
}
export type AnswerResult = Answered | { status: "not_question"; text: ""; intent: Intent };

/** 날짜를 못 읽은 질문에 한 번에 보여 줄 최대 항목 수(가까운 순) */
const UPCOMING_LIMIT = 5;
const UPCOMING_DAYS = 400;
const MAX_LINES = 20;
const LLM_RANGE_REACH = 800;

const EXAMPLE = '예: "이번 주 토요일 뭐 있어?"';
const clarify = (text: string, range?: DateRange): Answered => ({ status: "clarify", text, range, eventIds: [], anniversaries: [], taskIds: [] });

/**
 * 메시지 하나에 질문으로 답한다. 위키는 읽기만 한다(타입이 read만 허용).
 * 다른 가족 id 등 위키 저장소의 거부는 되묻기로 숨기지 않고 그대로 던진다.
 */
export async function answerQuestion(
  input: { text: string; now?: Date; familyId: FamilyId; senderSlackId?: string },
  deps: { wiki: Pick<WikiRepository, "read">; llm: LlmAdapter },
): Promise<AnswerResult> {
  const wiki = await deps.wiki.read(input.familyId);
  const intent = await extractIntent({ text: input.text, now: input.now, senderSlackId: input.senderSlackId, ...wiki }, deps.llm);
  if (intent.type === "question") {
    return answerFromQuery(intent.query, {
      today: todayIn(input.now ?? new Date()),
      members: wiki.members,
      events: wiki.events,
      tasks: wiki.tasks,
      anniversaries: wiki.anniversaries,
    });
  }
  if (intent.type === "unknown" && intent.cause) {
    return clarify(`질문을 잘 이해하지 못했어요. 날짜를 넣어서 다시 물어봐 주세요. (${EXAMPLE})`);
  }
  return { status: "not_question", text: "", intent };
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
/** 제목과 단어가 포함 관계인가(어느 쪽이 포함하든): "학원"↔"미술학원", "핼러윈 파티"↔"핼러윈" */
const related = (title: string, kw: string) => {
  const t = norm(title);
  const k = norm(kw);
  return k !== "" && (t.includes(k) || k.includes(t));
};

/** 한글 단어 안에서 걸리지 않게: 앞에 한글이 붙어 있으면("회사야") 단서로 보지 않는다. */
const SHOPPING = /(?<![가-힣])(장보기|사야|살\s*(?:것|거|게)|쇼핑)/;
const TODO = /(?<![가-힣])할\s*일(?!정)/;
const CALENDAR_WORD = /일정|약속|스케줄/;
const ANNIV_WORD = /생일|기념일/;

const JOSA = /^(?:이랑|이가|이는|이도|이의|이를|한테|에게|랑|이|가|은|는|의|도|를|을|와|과|에|께|만|네|아|야|일정|생일|기념일|약속|스케줄|할\s*일|장보기)(?![가-힣])/;
/** 구성원 이름이 글에 나오는가: "하늘이랑"은 맞고 "하늘색"·"새하늘"은 아니다. */
function nameIn(text: string, name: string): boolean {
  if (!name) return false;
  for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
    const before = text[i - 1];
    if (before && /[가-힣]/.test(before)) continue;
    const rest = text.slice(i + name.length);
    if (rest === "" || !/^[가-힣]/.test(rest) || JOSA.test(rest)) return true;
  }
  return false;
}

/** LLM이 준 범위를 검증한다. 형식이 맞으면 그대로 쓴다(범위 길이가 62일을 넘으면 too_long). 없거나 틀리면 undefined. */
function llmRange(q: QuestionQuery, today: string): DateRange | "too_long" | undefined {
  const from = q.from ?? q.to;
  const to = q.to ?? q.from;
  if (!from || !to || !isDate(from) || !isDate(to) || from > to) return undefined;
  if (Math.abs(diffDays(today, from)) > LLM_RANGE_REACH || Math.abs(diffDays(today, to)) > LLM_RANGE_REACH) return undefined;
  if (diffDays(from, to) + 1 > MAX_SPAN_DAYS) return "too_long";
  return { from, to };
}

function chooseRange(q: QuestionQuery, today: string): DateRange | "too_long" | "ambiguous" | undefined {
  const l = llmRange(q, today);
  if (l) return l;
  // 보조: LLM 범위가 없거나 형식이 틀릴 때만 정규식 해석기를 쓴다. 이 경우에도 못 읽으면 되묻는다.
  const r = resolveRange(q.text, today);
  if (r && "error" in r) return r.error;
  return r;
}

interface Item {
  date: string;
  sortTime: string;
  line: string;
  eventId?: string;
  anniversary?: string;
}

/** 이/가 */
const iga = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0 ? "이" : "가";
};

/**
 * 범위(또는 질문의 다른 단서)로 위키 항목을 골라 문장으로 만든다. LLM이 쓴 문장은 쓰지 않는다.
 * 종류는 글의 단서가 정한다. 날짜 범위가 잡히면 일정+기념일을 항상 넣고, LLM의 qKinds는 날짜가 없을 때
 * 할 일·장보기를 더하는 데만 쓴다(좁히기·되묻기 판단에는 쓰지 않는다).
 */
export function answerFromQuery(q: QuestionQuery, ctx: AnswerContext): Answered {
  const { today } = ctx;
  const nameOf = (id?: string) => ctx.members.find((m) => m.id === id)?.name ?? "";

  const wantShopping = SHOPPING.test(q.text);
  const wantTodo = TODO.test(q.text);
  const annivOnly = ANNIV_WORD.test(q.text) && !CALENDAR_WORD.test(q.text);
  const calendarKinds = new Set<QuestionKind>(annivOnly ? ["anniversaries"] : ["events", "anniversaries"]);

  // 구성원: 질문에 이름이 나오거나, LLM이 준 id가 실제 구성원일 때
  const wanted = new Set<string>(ctx.members.filter((m) => m.id !== "family" && nameIn(q.text, m.name)).map((m) => m.id));
  for (const id of q.memberIds ?? []) if (ctx.members.some((m) => m.id === id && id !== "family")) wanted.add(id);
  const memberPrefix = [...wanted].map(nameOf).join("·");
  // 키워드는 질문에 글자 그대로 있을 때만 쓴다(없는 말로 걸러서 "없어요"라고 잘못 답하지 않게)
  // 위키의 일정·기념일 제목 어디에도 없는 말("계획"·"행사"·"하늘이"·"하는 날이야")과 구성원 이름은 일정 이름이 아니라
  // 서술어이므로 거르지 않는다. 날짜가 분명한 질문이 "없어요"로 끝나지 않게 한다. 날짜 없이 이름만 물으면 아래에서 없다고 답한다.
  // LLM keyword는 질문에 글자 그대로 있거나, 위키 제목과 포함 관계(어느 쪽이 포함하든)일 때 받는다. 둘 다 아니면 환각으로 보고 거른다.
  const titlesNow = [...ctx.events.map((e) => e.title), ...ctx.anniversaries.map((a) => a.title)];
  const inTitles = (kw: string) => titlesNow.some((t) => related(t, kw));
  const inText = q.keyword && (norm(q.text).includes(norm(q.keyword)) || inTitles(q.keyword)) ? q.keyword : undefined;
  // "말고" 제외는 LLM이 정한다. 제외 단어는 위키 제목과 포함 관계일 때만, 날짜는 형식이 맞을 때만 쓴다(질문 글자와 달라도 된다: "핼러윈" -> "핼러윈 파티").
  const exclude = q.excludeKeyword && inTitles(q.excludeKeyword) ? q.excludeKeyword : undefined;
  const excludeDates = [...new Set((q.excludeDates ?? []).filter((d) => isDate(d)))];
  const rawKeyword = inText && !(exclude && related(exclude, inText) && related(inText, exclude)) ? inText : undefined;
  const picked = chooseRange(q, today);
  const isMemberName = (kw: string) => ctx.members.some((m) => m.id !== "family" && nameIn(kw, m.name));
  const keyword = rawKeyword && !(picked && typeof picked === "object" && (!inTitles(rawKeyword) || isMemberName(rawKeyword))) ? rawKeyword : undefined;
  const prefix = `${memberPrefix ? `${memberPrefix} ` : ""}${keyword ? `'${keyword}' ` : ""}`;

  if (picked === "too_long") return clarify(`한 번에 보여 드리기엔 기간이 너무 길어요. 두 달 이내로 다시 물어봐 주세요. (${EXAMPLE})`);
  if (picked === "ambiguous") return clarify(`날짜가 띄엄띄엄 떨어져 있어서 하나로 묶기 어려워요. 하나씩 나눠서 물어봐 주세요. (${EXAMPLE})`);
  const upcoming = !picked && (!!keyword || annivOnly || !!exclude);
  const wantsTasks = wantShopping || wantTodo || (!picked && !!q.kinds?.includes("tasks"));
  if (!picked && !upcoming && !wantsTasks) return clarify(`언제 일정을 볼까요? 날짜를 알려 주세요. (${EXAMPLE})`);

  const sections: string[] = [];
  const out: Answered = { status: "empty", text: "", eventIds: [], anniversaries: [], taskIds: [] };
  let any = false;

  if (picked || upcoming) {
    const range: DateRange = picked ?? { from: today, to: addDays(today, UPCOMING_DAYS) };
    const noun = calendarKinds.has("events") ? "일정" : "기념일";
    // 제외 날짜는 고른 범위 안의 것만 쓴다. 범위 전체를 덮으면 제외를 버린다(전부 빼면 답할 게 없다).
    const inRange = excludeDates.filter((d) => d >= range.from && d <= range.to);
    const exDates = inRange.length >= diffDays(range.from, range.to) + 1 ? [] : inRange;
    const items = collect(ctx, range, calendarKinds, wanted, keyword, exclude, exDates);
    // 뺀 게 있을 때만 밝힌다("치과 말고는 … 없어요")
    const removed = exclude || exDates.length ? collect(ctx, range, calendarKinds, wanted, keyword).length - items.length : 0;
    const exceptWhat = [...(exclude ? [`'${exclude}'`] : []), ...exDates.map(formatDay)].join(", ");
    const except = removed > 0 ? `${exceptWhat} 말고` : "";
    const shown = items.slice(0, picked ? MAX_LINES : UPCOMING_LIMIT);
    const label = picked ? (range.from === range.to ? formatDay(range.from) : `${formatDay(range.from)}~${formatDay(range.to)}`) : "";
    out.range = range;
    if (!items.length) {
      sections.push(
        picked
          ? `${label}에는 ${prefix}${except ? `${except}는 ` : ""}위키에 등록된 ${noun}이 없어요.`
          : `앞으로 ${UPCOMING_DAYS}일 안에는 ${prefix}${except ? `${except}는 ` : ""}위키에 등록된 ${noun}이 없어요.`,
      );
    } else {
      any = true;
      const lines = shown.map((i) => i.line);
      if (items.length > shown.length) lines.push(`…외 ${items.length - shown.length}건`);
      sections.push([`${picked ? `${label} ` : "가까운 "}${prefix}${except ? `${except} ` : ""}${noun} ${items.length}건이에요.`, ...lines].join("\n"));
      out.eventIds = shown.flatMap((i) => (i.eventId ? [i.eventId] : []));
      out.anniversaries = shown.flatMap((i) => (i.anniversary ? [i.anniversary] : []));
    }
  }

  if (wantsTasks) {
    const both = !wantShopping && !wantTodo;
    const lists: ("shopping" | "todo")[] = both ? ["shopping", "todo"] : [...(wantShopping ? (["shopping"] as const) : []), ...(wantTodo ? (["todo"] as const) : [])];
    for (const list of lists) {
      const label = list === "shopping" ? "장보기" : "할 일";
      const found = ctx.tasks.filter((t) => t.list === list && !t.done && (!wanted.size || (t.member !== undefined && wanted.has(t.member))));
      if (!found.length) {
        sections.push(`남은 ${memberPrefix ? `${memberPrefix} ` : ""}${label}${iga(label)} 없어요.`);
        continue;
      }
      any = true;
      const shown = found.slice(0, MAX_LINES);
      const lines = shown.map((t) => `• ${t.title}${t.member && nameOf(t.member) ? ` (${nameOf(t.member)})` : ""}`);
      if (found.length > shown.length) lines.push(`…외 ${found.length - shown.length}건`);
      sections.push([`남은 ${memberPrefix ? `${memberPrefix} ` : ""}${label} ${found.length}개예요.`, ...lines].join("\n"));
      out.taskIds.push(...shown.map((t) => t.id));
    }
  }

  return { ...out, status: any ? "answered" : "empty", text: sections.join("\n\n") };
}

/** 범위 안의 일정·기념일(매년 반복은 범위 안 발생일로 펼친다) */
function collect(ctx: AnswerContext, range: DateRange, kinds: Set<QuestionKind>, wanted: Set<string>, keyword?: string, exclude?: string, excludeDates: string[] = []): Item[] {
  const nameOf = (id?: string) => ctx.members.find((m) => m.id === id)?.name ?? "";
    const yearOf = (d: string) => (d.slice(0, 4) === ctx.today.slice(0, 4) ? "" : `${d.slice(0, 4)}년 `);
    const hit = (title: string) => (!keyword || related(title, keyword)) && !(exclude && related(title, exclude));
  const items: Item[] = [];

  if (kinds.has("events")) {
    for (const e of ctx.events) {
      if (e.date < range.from || e.date > range.to || excludeDates.includes(e.date) || !hit(e.title)) continue;
      // 구성원을 지정하면 그 사람 일정과 가족 전체 일정
      if (wanted.size && !e.members.some((m) => wanted.has(m) || m === "family")) continue;
      const who = e.members.map(nameOf).filter(Boolean).join("·");
      const time = !e.allDay && e.start ? `${e.end ? `~${e.end}` : ""}` : "";
      items.push({
        date: e.date,
        sortTime: e.allDay || !e.start ? "00:00" : e.start,
        eventId: e.id,
        line: `• ${yearOf(e.date)}${formatWhen(e.date, e.start, e.allDay)}${time} ${e.title}${who ? ` (${who})` : ""}${e.share ? ` · 공유: ${e.share}` : ""}`,
      });
    }
  }
  if (kinds.has("anniversaries")) {
    for (const a of ctx.anniversaries) {
      if (!hit(a.title)) continue;
      if (wanted.size && !(a.member && wanted.has(a.member))) continue;
      for (let d = nextOccurrence(a.monthDay, range.from); d <= range.to; d = nextOccurrence(a.monthDay, addDays(d, 1))) {
        if (excludeDates.includes(d)) continue;
        items.push({ date: d, sortTime: "00:00", anniversary: a.title, line: `• ${yearOf(d)}${formatWhen(d, undefined, true)} 🎉 ${a.title} (매년)` });
      }
    }
  }
  return items.sort((a, b) => (a.date + a.sortTime).localeCompare(b.date + b.sortTime));
}
