// 질문 응답. LLM은 범위(날짜·종류·구성원·키워드)만 뽑고, 답 문장은 여기서 위키 항목으로 결정적으로 만든다.
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

function detectKinds(text: string, llm?: QuestionKind[]): { kinds: Set<QuestionKind>; explicit: boolean; shopping: boolean; todo: boolean } {
  const wantShopping = /장보기|사야|살\s*(것|거|게)|쇼핑/.test(text);
  const wantTodo = /할\s*일/.test(text);
  const kinds = new Set<QuestionKind>();
  if (wantShopping || wantTodo) {
    kinds.add("tasks");
    if (/일정|약속|스케줄/.test(text)) kinds.add("events").add("anniversaries");
    return { kinds, explicit: true, shopping: wantShopping, todo: wantTodo };
  }
  if (/생일|기념일/.test(text) && !/일정|약속/.test(text)) return { kinds: new Set(["anniversaries"]), explicit: true, shopping: false, todo: false };
  if (llm?.length) {
    for (const k of llm) kinds.add(k);
    return { kinds, explicit: true, shopping: false, todo: false };
  }
  return { kinds: new Set(["events", "anniversaries"]), explicit: false, shopping: false, todo: false };
}

function chooseRange(q: QuestionQuery, today: string): DateRange | "too_long" | undefined {
  const r = resolveRange(q.text, today);
  if (r && "error" in r) return "too_long";
  if (r) return r;
  // 코드가 못 읽었을 때만 LLM 값을 쓴다. 검증을 통과해야 한다.
  const from = q.from ?? q.to;
  const to = q.to ?? q.from;
  if (!from || !to || !isDate(from) || !isDate(to) || from > to) return undefined;
  if (Math.abs(diffDays(today, from)) > LLM_RANGE_REACH || Math.abs(diffDays(today, to)) > LLM_RANGE_REACH) return undefined;
  if (diffDays(from, to) + 1 > MAX_SPAN_DAYS) return "too_long";
  return { from, to };
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

/** 범위(또는 질문의 다른 단서)로 위키 항목을 골라 문장으로 만든다. LLM이 쓴 문장은 쓰지 않는다. */
export function answerFromQuery(q: QuestionQuery, ctx: AnswerContext): Answered {
  const { today } = ctx;
  const { kinds, explicit, shopping, todo } = detectKinds(q.text, q.kinds);
  const nameOf = (id?: string) => ctx.members.find((m) => m.id === id)?.name ?? "";

  // 구성원: 질문에 이름이 나오거나, LLM이 준 id가 실제 구성원일 때
  const wanted = new Set<string>(ctx.members.filter((m) => m.id !== "family" && q.text.includes(m.name)).map((m) => m.id));
  for (const id of q.memberIds ?? []) if (ctx.members.some((m) => m.id === id && id !== "family")) wanted.add(id);
  const memberPrefix = [...wanted].map(nameOf).join("·");
  // 키워드는 질문에 글자 그대로 있을 때만 쓴다(없는 말로 걸러서 "없어요"라고 잘못 답하지 않게)
  const keyword = q.keyword && norm(q.text).includes(norm(q.keyword)) ? q.keyword : undefined;
  const prefix = `${memberPrefix ? `${memberPrefix} ` : ""}${keyword ? `'${keyword}' ` : ""}`;

  const sections: string[] = [];
  const out: Answered = { status: "empty", text: "", eventIds: [], anniversaries: [], taskIds: [] };
  let any = false;

  const wantsCalendar = kinds.has("events") || kinds.has("anniversaries");
  if (wantsCalendar) {
    const picked = chooseRange(q, today);
    if (picked === "too_long") return clarify(`한 번에 보여 드리기엔 기간이 너무 길어요. 두 달 이내로 다시 물어봐 주세요. (${EXAMPLE})`);
    const upcoming = !picked && (!!keyword || (explicit && !kinds.has("tasks")));
    if (!picked && !upcoming && !kinds.has("tasks")) {
      return clarify(`언제 일정을 볼까요? 날짜를 알려 주세요. (${EXAMPLE})`);
    }
    if (picked || upcoming) {
      const range: DateRange = picked ?? { from: today, to: addDays(today, UPCOMING_DAYS) };
      const noun = kinds.has("events") ? "일정" : "기념일";
      let items = collect(ctx, range, kinds, wanted, keyword);
      if (upcoming) items = items.slice(0, UPCOMING_LIMIT);
      const label = picked ? (range.from === range.to ? formatDay(range.from) : `${formatDay(range.from)}~${formatDay(range.to)}`) : "";
      out.range = range;
      if (!items.length) {
        sections.push(
          picked
            ? `${label}에는 ${prefix}위키에 등록된 ${noun}이 없어요.`
            : `앞으로 ${UPCOMING_DAYS}일 안에는 ${prefix}위키에 등록된 ${noun}이 없어요.`,
        );
      } else {
        any = true;
        const shown = items.slice(0, MAX_LINES);
        const head = `${picked ? `${label} ` : "가까운 "}${prefix}${noun} ${items.length}건이에요.`;
        const lines = shown.map((i) => i.line);
        if (items.length > shown.length) lines.push(`…외 ${items.length - shown.length}건`);
        sections.push([head, ...lines].join("\n"));
        out.eventIds = items.flatMap((i) => (i.eventId ? [i.eventId] : []));
        out.anniversaries = items.flatMap((i) => (i.anniversary ? [i.anniversary] : []));
      }
    }
  }

  if (kinds.has("tasks")) {
    const both = !shopping && !todo;
    const lists: ("shopping" | "todo")[] = both ? ["shopping", "todo"] : [...(shopping ? (["shopping"] as const) : []), ...(todo ? (["todo"] as const) : [])];
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
function collect(ctx: AnswerContext, range: DateRange, kinds: Set<QuestionKind>, wanted: Set<string>, keyword?: string): Item[] {
  const nameOf = (id?: string) => ctx.members.find((m) => m.id === id)?.name ?? "";
  const kw = keyword ? norm(keyword) : undefined;
  const hit = (title: string) => !kw || norm(title).includes(kw);
  const items: Item[] = [];

  if (kinds.has("events")) {
    for (const e of ctx.events) {
      if (e.date < range.from || e.date > range.to || !hit(e.title)) continue;
      // 구성원을 지정하면 그 사람 일정과 가족 전체 일정
      if (wanted.size && !e.members.some((m) => wanted.has(m) || m === "family")) continue;
      const who = e.members.map(nameOf).filter(Boolean).join("·");
      const time = !e.allDay && e.start ? `${e.end ? `~${e.end}` : ""}` : "";
      items.push({
        date: e.date,
        sortTime: e.allDay || !e.start ? "00:00" : e.start,
        eventId: e.id,
        line: `• ${formatWhen(e.date, e.start, e.allDay)}${time} ${e.title}${who ? ` (${who})` : ""}${e.share ? ` · 공유: ${e.share}` : ""}`,
      });
    }
  }
  if (kinds.has("anniversaries")) {
    for (const a of ctx.anniversaries) {
      if (!hit(a.title)) continue;
      if (wanted.size && !(a.member && wanted.has(a.member))) continue;
      for (let d = nextOccurrence(a.monthDay, range.from); d <= range.to; d = nextOccurrence(a.monthDay, addDays(d, 1))) {
        items.push({ date: d, sortTime: "00:00", anniversary: a.title, line: `• ${formatWhen(d, undefined, true)} 🎉 ${a.title} (매년)` });
      }
    }
  }
  return items.sort((a, b) => (a.date + a.sortTime).localeCompare(b.date + b.sortTime));
}
