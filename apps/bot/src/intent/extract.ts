// 메시지 → Change 후보. LLM 응답을 그대로 믿지 않고, 코드가 검증·보정해서 Change로 만든다.
import {
  addDays,
  changeSchema,
  diffDays,
  isDate,
  isMonthDay,
  isTime,
  timeIn,
  todayIn,
  weekdayKo,
  type Change,
  type LlmAdapter,
  type Event,
  type Member,
  type Task,
} from "@hsh/core";
import { buildSystemPrompt, llmOutputJsonSchema, llmOutputSchema, type LlmOutput } from "./prompt";

export type Intent =
  /** 확인 버튼을 띄울 변경들 (장보기 여러 개는 changes 여러 개) */
  | { type: "change"; changes: Change[]; preview: string }
  /** 대상이 여럿이라 골라야 함 */
  | { type: "choose"; kind: "event.update" | "event.remove" | "task.done"; candidates: string[]; patch?: Partial<Event>; preview: string }
  | { type: "question" }
  | { type: "unknown"; reason: string };

export interface ExtractInput {
  text: string;
  now?: Date;
  senderSlackId?: string;
  members: Member[];
  events: Event[];
  tasks: Task[];
}

/** 일정으로 받아들이는 날짜 범위: 오늘-1일 ~ 오늘+400일 */
const DATE_WINDOW = { past: -1, future: 400 };

export async function extractIntent(input: ExtractInput, llm: LlmAdapter): Promise<Intent> {
  const now = input.now ?? new Date();
  const today = todayIn(now);
  const sender = input.members.find((m) => m.slackId && m.slackId === input.senderSlackId);
  const system = buildSystemPrompt({ today, now: timeIn(now), sender, members: input.members, events: input.events, tasks: input.tasks });

  let raw: unknown;
  try {
    raw = await llm.json({ system, user: input.text, schema: llmOutputJsonSchema });
  } catch (e) {
    return { type: "unknown", reason: `LLM 호출 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = llmOutputSchema.safeParse(raw);
  if (!parsed.success) return { type: "unknown", reason: "LLM 응답 형식 오류" };
  return toIntent(parsed.data, { ...input, today, sender });
}

interface Ctx extends ExtractInput {
  today: string;
  sender?: Member;
}

function toIntent(o: LlmOutput, ctx: Ctx): Intent {
  const memberIds = new Set(ctx.members.map((m) => m.id));
  const pickMembers = (ids?: string[]) => {
    const valid = (ids ?? []).filter((id) => memberIds.has(id));
    return valid.length ? [...new Set(valid)] : [ctx.sender?.id ?? "family"];
  };
  const okDate = (d?: string): d is string => {
    if (!d || !isDate(d)) return false;
    const n = diffDays(ctx.today, d);
    return n >= DATE_WINDOW.past && n <= DATE_WINDOW.future;
  };
  const okTime = (t?: string): t is string => !!t && isTime(t);
  const valid = (c: Change) => changeSchema.safeParse(c).success;

  switch (o.intent) {
    case "question":
      return { type: "question" };

    case "event.add": {
      if (!okDate(o.date)) return { type: "unknown", reason: "날짜를 알 수 없어요" };
      const allDay = o.allDay === true || !okTime(o.start);
      const change: Change = {
        kind: "event.add",
        payload: {
          date: o.date,
          start: allDay ? undefined : o.start,
          end: !allDay && okTime(o.end) && o.end > (o.start ?? "") ? o.end : undefined,
          allDay,
          title: cleanTitle(o.title),
          members: pickMembers(o.members),
        },
      };
      if (!valid(change)) return { type: "unknown", reason: "일정 내용을 알 수 없어요" };
      return { type: "change", changes: [change], preview: previewChange(change, ctx) };
    }

    case "event.update":
    case "event.remove": {
      const known = new Set(ctx.events.map((e) => e.id));
      const ids = (o.targetIds ?? []).filter((id) => known.has(id));
      if (!ids.length) return { type: "unknown", reason: "어떤 일정인지 찾지 못했어요" };
      const patch: Partial<Event> = {};
      if (o.intent === "event.update") {
        if (okDate(o.date)) patch.date = o.date;
        if (okTime(o.start)) {
          patch.start = o.start;
          patch.allDay = false;
          // 끝 시간은 LLM이 명시했을 때만 넣는다. 안 줬으면 대상이 정해진 뒤에 원래 길이로 계산한다.
          if (okTime(o.end)) patch.end = o.end;
        } else if (o.allDay) patch.allDay = true;
        if (o.title) patch.title = cleanTitle(o.title);
        if (o.members?.length) patch.members = pickMembers(o.members);
        if (!Object.keys(patch).length) return { type: "unknown", reason: "무엇을 바꿀지 알 수 없어요" };
      }
      if (ids.length > 1) {
        return { type: "choose", kind: o.intent, candidates: ids, patch, preview: "어떤 일정인가요?" };
      }
      return buildEventChange(o.intent, ids[0] ?? "", patch, ctx);
    }

    case "task.add": {
      const changes: Change[] = (o.items ?? [])
        .map((i): Change => ({
          kind: "task.add",
          payload: { list: i.list, title: cleanTitle(i.title), member: i.member && memberIds.has(i.member) ? i.member : undefined },
        }))
        .filter(valid);
      if (!changes.length) return { type: "unknown", reason: "추가할 항목을 알 수 없어요" };
      return { type: "change", changes, preview: changes.map((c) => previewChange(c, ctx)).join("\n") };
    }

    case "task.done": {
      const open = new Set(ctx.tasks.filter((t) => !t.done).map((t) => t.id));
      const ids = (o.targetIds ?? []).filter((id) => open.has(id));
      if (!ids.length) return { type: "unknown", reason: "목록에서 찾지 못했어요" };
      // "우유랑 사과 샀어"처럼 여러 개를 한 번에 끝낼 수 있다 → 모두 완료
      const changes: Change[] = ids.map((id) => ({ kind: "task.done", payload: { id } }));
      return { type: "change", changes, preview: changes.map((c) => previewChange(c, ctx)).join("\n") };
    }

    case "anniversary.add": {
      const md = o.monthDay ?? (o.date && isDate(o.date) ? o.date.slice(5) : undefined);
      if (!md || !isMonthDay(md)) return { type: "unknown", reason: "날짜를 알 수 없어요" };
      const ms = (o.members ?? []).filter((id) => memberIds.has(id));
      const change: Change = { kind: "anniversary.add", payload: { monthDay: md, title: cleanTitle(o.title), member: ms[0] ?? "family" } };
      if (!valid(change)) return { type: "unknown", reason: "기념일 내용을 알 수 없어요" };
      return { type: "change", changes: [change], preview: previewChange(change, ctx) };
    }

    default:
      return { type: "unknown", reason: "일정·할 일과 관련 없는 메시지" };
  }
}

/** event.update / event.remove 하나를 만든다. 대상이 정해진 뒤에 끝 시간을 계산한다. */
function buildEventChange(
  kind: "event.update" | "event.remove",
  id: string,
  patch: Partial<Event>,
  ctx: Pick<Ctx, "members" | "events" | "tasks" | "today">,
): Intent {
  let change: Change;
  if (kind === "event.remove") change = { kind, payload: { id } };
  else {
    const fixed = { ...patch };
    const orig = ctx.events.find((e) => e.id === id);
    if (fixed.start && fixed.end === undefined && orig) {
      // 시작만 바꾸면 원래 길이를 유지한다
      const end = shiftEnd(orig, fixed.start);
      if (end === null) return { type: "unknown", reason: "끝 시간을 계산할 수 없어요. 끝나는 시간도 함께 알려 주세요" };
      if (end) fixed.end = end;
    }
    change = { kind, payload: { id, ...fixed } };
  }
  if (!changeSchema.safeParse(change).success) return { type: "unknown", reason: "수정 내용을 알 수 없어요" };
  return { type: "change", changes: [change], preview: previewChange(change, ctx) };
}

/** 사용자가 후보 중 하나를 골랐을 때 Change로 마무리한다. 끝 시간도 이때 계산한다. */
export function resolveChoice(
  choice: Extract<Intent, { type: "choose" }>,
  id: string,
  ctx: Pick<Ctx, "members" | "events" | "tasks" | "today">,
): Intent {
  if (!choice.candidates.includes(id)) return { type: "unknown", reason: "고를 수 없는 항목이에요" };
  if (choice.kind === "task.done") {
    const change: Change = { kind: "task.done", payload: { id } };
    return { type: "change", changes: [change], preview: previewChange(change, ctx) };
  }
  return buildEventChange(choice.kind, id, choice.patch ?? {}, ctx);
}

function cleanTitle(t?: string): string {
  return (t ?? "").replace(/[#@\n]/g, " ").replace(/(^|\s)&+(?=\S)/g, "$1").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** 원래 길이를 유지한 새 끝 시간. 원래 끝이 없으면 undefined, 자정을 넘으면 null(계산 불가) */
function shiftEnd(orig: Event, newStart: string): string | null | undefined {
  if (!orig.start || !orig.end) return undefined;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const end = toMin(newStart) + (toMin(orig.end) - toMin(orig.start));
  if (end >= 24 * 60) return null;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/** "11/3(화) 15:00 하늘 치과" */
export function formatWhen(date: string, start?: string, allDay?: boolean): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}(${weekdayKo(date)})${allDay || !start ? " 종일" : ` ${start}`}`;
}

export function previewChange(c: Change, ctx: Pick<Ctx, "members" | "events" | "tasks" | "today">): string {
  const name = (id?: string) => ctx.members.find((m) => m.id === id)?.name ?? "";
  const who = (ids: string[]) => ids.map(name).filter(Boolean).join("·");
  switch (c.kind) {
    case "event.add": {
      const p = c.payload;
      const rel = relDay(ctx.today, p.date);
      return `${formatWhen(p.date, p.start, p.allDay)}${p.end ? `~${p.end}` : ""} ${who(p.members)} ${p.title}${rel}`.replace(/\s+/g, " ");
    }
    case "event.update": {
      const orig = ctx.events.find((e) => e.id === c.payload.id);
      if (!orig) return `일정 수정: ${c.payload.id}`;
      const next: Event = { ...orig, ...c.payload };
      return `${orig.title}: ${formatWhen(orig.date, orig.start, orig.allDay)} → ${formatWhen(next.date, next.start, next.allDay)}`;
    }
    case "event.remove": {
      const e = ctx.events.find((x) => x.id === c.payload.id);
      return `삭제: ${e ? `${formatWhen(e.date, e.start, e.allDay)} ${e.title}` : c.payload.id}`;
    }
    case "task.add":
      return `${c.payload.list === "shopping" ? "🛒 장보기" : "✅ 할 일"}: ${c.payload.title}`;
    case "task.done":
      return `완료: ${ctx.tasks.find((t) => t.id === c.payload.id)?.title ?? c.payload.id}`;
    case "anniversary.add": {
      const [m, d] = c.payload.monthDay.split("-");
      return `🎉 매년 ${Number(m)}월 ${Number(d)}일 ${c.payload.title}`;
    }
  }
}

function relDay(today: string, date: string): string {
  const n = diffDays(today, date);
  if (n === 0) return " (오늘)";
  if (n === 1) return " (내일)";
  if (date === addDays(today, 2)) return " (모레)";
  return "";
}
