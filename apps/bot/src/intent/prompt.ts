// 의도 추출 프롬프트. 날짜·시제·"말고" 판단은 LLM이 한다(MVP 스펙 rev 63). 코드는 결과를 검증만 한다.
// 모자란 지식은 자산 지도(달력표·구성원 부르는 이름·일정/기념일 제목 관계)로 보충하고, rev 62 규칙을 판단 기준으로 명시한다.
import { WEEKDAYS_KO, addDays, addMonths, buildAssetMap, weekdayOf, type Anniversary, type Event, type Member, type Task } from "@hsh/core";
import { z } from "zod";

export interface PromptContext {
  today: string;
  now: string;
  sender?: Member;
  members: Member[];
  events: Event[];
  tasks: Task[];
  anniversaries?: Anniversary[];
  /** 자산 지도 글자 수 상한(기본 3000). 프롬프트 전체 상한을 넘으면 더 줄어든다 */
  assetMapChars?: number;
  /** 프롬프트 전체 글자 수 상한(기본 PROMPT_MAX_CHARS) */
  maxChars?: number;
}

/** 프롬프트 전체 상한(글자). 작은 로컬 모델의 문맥을 아끼려고 자산 지도·일정·할 일을 이 안에서 줄인다. */
export const PROMPT_MAX_CHARS = 8000;
const MAP_MIN_CHARS = 1200;
const EVENTS_LIMIT = 40;
const TASKS_LIMIT = 30;
const MEMBERS_LIMIT = 30;
const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 그날 기준으로 계산한 날짜 표현. 표의 '다음 주' 줄과 일요일 예외가 부딪히지 않게 값을 직접 적는다. */
function datePoints(today: string): string {
  const dow = weekdayOf(today);
  const sunday = addDays(today, -dow);
  const comingSunday = addDays(today, (7 - dow) % 7);
  const monthEnd = (m: string) => addDays(`${addMonths(m, 1)}-01`, -1);
  const m0 = today.slice(0, 7);
  const m1 = addMonths(m0, 1);
  const split = "되묻기: 오늘이 일요일이라 토요일과 일요일이 떨어져 있다. qFrom·qTo를 비운다";
  return [
    `- 이번 주 일요일 = ${comingSunday}, 다음 주 일요일 = ${addDays(comingSunday, 7)}`,
    `- 이번 주말 = ${dow === 0 ? split : `${addDays(sunday, 6)} ~ ${comingSunday}`}, 다음 주말 = ${dow === 0 ? split : `${addDays(sunday, 13)} ~ ${addDays(comingSunday, 7)}`}`,
    `- 이번 달 = ${m0}-01 ~ ${monthEnd(m0)}, 다음 달 = ${m1}-01 ~ ${monthEnd(m1)}`,
  ].join("\n");
}

/** LLM 응답 형식 — 작은 로컬 모델도 맞추기 쉽게 평평하게 둔다. */
export const llmOutputSchema = z.object({
  intent: z.enum([
    "event.add",
    "event.update",
    "event.remove",
    "task.add",
    "task.done",
    "anniversary.add",
    "question",
    "unknown",
  ]),
  /** event.add / event.update의 새 값 */
  date: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  allDay: z.boolean().optional(),
  title: z.string().optional(),
  members: z.array(z.string()).optional(),
  /** task.add: 항목 여러 개 */
  items: z.array(z.object({ title: z.string(), list: z.enum(["shopping", "todo"]), member: z.string().optional() })).optional(),
  /** event.update / event.remove / task.done 대상 후보 id (확실하면 1개) */
  targetIds: z.array(z.string()).optional(),
  /** anniversary.add */
  monthDay: z.string().optional(),
  /** question: 묻는 범위. 답 문장은 코드가 위키에서 만들므로 범위만 뽑는다 */
  /** 시제를 먼저 정하게 qFrom보다 앞에 둔다: past = 과거형("뭐 했어?"·"있었지?"), nonpast = 그 외 */
  qTense: z.enum(["past", "nonpast"]).optional(),
  /** "A 말고 B"의 A가 일정 이름이면 제외할 단어, 날짜면 제외할 날짜(YYYY-MM-DD). 실제 질문 범위는 B */
  qExcludeKeyword: z.string().optional(),
  qExcludeDates: z.array(z.string()).optional(),
  qFrom: z.string().optional(),
  qTo: z.string().optional(),
  qKinds: z.array(z.enum(["events", "tasks", "anniversaries"])).optional(),
  qMembers: z.array(z.string()).optional(),
  qKeyword: z.string().optional(),
});
export type LlmOutput = z.infer<typeof llmOutputSchema>;
export const llmOutputJsonSchema: Record<string, unknown> = z.toJSONSchema(llmOutputSchema);

/** 프롬프트 전체가 상한 안에 들도록 자산 지도 -> 일정 -> 할 일 순으로 줄인다. */
export function buildSystemPrompt(ctx: PromptContext): string {
  const max = ctx.maxChars ?? PROMPT_MAX_CHARS;
  let mapChars = ctx.assetMapChars ?? 3000;
  let evN = EVENTS_LIMIT;
  let tkN = TASKS_LIMIT;
  let out = renderPrompt(ctx, mapChars, evN, tkN);
  while (out.length > max && (mapChars > MAP_MIN_CHARS || evN > 5 || tkN > 5)) {
    if (mapChars > MAP_MIN_CHARS) mapChars = Math.max(MAP_MIN_CHARS, mapChars - Math.max(300, out.length - max));
    else if (evN > 5) evN = Math.max(5, evN - 5);
    else tkN = Math.max(5, tkN - 5);
    out = renderPrompt(ctx, mapChars, evN, tkN);
  }
  return out;
}

function renderPrompt(ctx: PromptContext, mapChars: number, evN: number, tkN: number): string {
  const memberAll = ctx.members.map((m) => `- ${m.id}: ${m.name}${m.id === "family" ? " (가족 전체)" : ""}`)
  const members = (memberAll.length > MEMBERS_LIMIT ? [...memberAll.slice(0, MEMBERS_LIMIT), `- …외 ${memberAll.length - MEMBERS_LIMIT}명`] : memberAll).join("\n");
  // 쓰기 대상 id가 필요해 자산 지도와 겹쳐도 남긴다. 건수·제목 길이를 제한한다.
  const events = ctx.events
    .filter((e) => e.date >= ctx.today)
    .slice(0, evN)
    .map((e) => `- ${e.id}: ${e.date} ${e.allDay ? "종일" : (e.start ?? "")} ${clip(e.title)} (${e.members.join(",")})`)
    .join("\n");
  const open = ctx.tasks.filter((t) => !t.done);
  const tasks = [
    ...open.slice(0, tkN).map((t) => `- ${t.id}: [${t.list === "shopping" ? "장보기" : "할 일"}] ${clip(t.title)}`),
    ...(open.length > tkN ? [`- …외 ${open.length - tkN}건`] : []),
  ].join("\n");

  const assetMap = buildAssetMap(
    { today: ctx.today, members: ctx.members, events: ctx.events, anniversaries: ctx.anniversaries ?? [] },
    { maxChars: mapChars },
  );

  return `너는 가족 일정 비서다. 가족이 보낸 한국어 메시지 하나를 읽고 의도와 필드를 JSON으로만 답한다.
파일을 쓰거나 답장을 만들지 않는다. 모르는 것은 지어내지 않는다.

## 지금
- 오늘: ${ctx.today} (${WEEKDAYS_KO[weekdayOf(ctx.today)]}요일), 현재 시각 ${ctx.now}, 시간대 Asia/Seoul
- 보낸 사람: ${ctx.sender ? `${ctx.sender.id} (${ctx.sender.name})` : "알 수 없음"}

## 자산 지도 (위키에서 만든 관계표. 일정 이름의 짧은 단어("학원")도 여기서 찾는다)
${assetMap}

## 구성원 (보낸 사람 확인용)
${members || "- (없음)"}

## 앞으로의 일정
${events || "- (없음)"}

## 남은 할 일·장보기
${tasks || "- (없음)"}

## 날짜 판단 기준
- 주는 일요일에 시작해 토요일에 끝난다. "이번 주" = 오늘이 든 일~토, "다음 주" = 그다음 일~토, "지난 주" = 그 전 일~토.
- 예외: "이번 주 일요일" = 돌아오는 일요일(오늘이 일요일이면 오늘), "다음 주 일요일" = 그다음 일요일. "이번 주말" = 이번 주 토요일 + 돌아오는 일요일.
- 연도 없는 날짜("5월 1일", "12월")와 요일만 말한 경우: 과거형("뭐 했어?", "있었지?")이면 가장 최근에 지난 날(오늘은 지난 날이 아니다), 그 외에는 다가오는 날(오늘 포함). 미래·추측("있겠지?", "~할 거야")은 과거형이 아니다.
- 연도를 말하면("2027년 5월 1일") 그대로 쓴다.
- 질문이면 qTense를 먼저 정한다: 과거형이면 "past", 아니면 "nonpast". 그다음 qFrom·qTo를 정한다.
- "A 말고 B": A는 제외 조건, B가 실제 질문이다. A가 날짜·요일뿐이면 그 날짜를 qExcludeDates(YYYY-MM-DD)에 넣고, A가 일정 이름이면 qExcludeKeyword에 넣는다. qFrom·qTo·qKeyword는 B로 채운다. B에 날짜가 없으면 qFrom·qTo는 비운다. 단 "토요일에 핼러윈 말고 뭐 있어?"처럼 날짜가 말고 앞의 이름과 함께 있으면 그 날짜가 질문 범위이고 이름("핼러윈")만 qExcludeKeyword다.
- 오늘(${ctx.today}) 기준으로 계산한 값:
${datePoints(ctx.today)}
- 범위는 최대 62일. 떨어진 두 날("오늘이랑 모레")은 하나로 묶지 말고 비워 둔다.
- 예(오늘 ${ctx.today}): 위 달력 표를 보고 "다음 주 화요일" -> 다음 주 줄의 화요일, "토요일 말고 미술학원 언제야?" -> qExcludeDates=[다가오는 토요일], qKeyword="미술학원", qFrom·qTo 없음.

## 규칙
- intent는 event.add, event.update, event.remove, task.add, task.done, anniversary.add, question, unknown 중 하나.
- 날짜는 위 자산 지도의 달력에서 찾아 YYYY-MM-DD로 쓴다. 계산하지 말고 달력 표에서 읽는다. 쓰기(event.add 등)와 질문(qFrom·qTo)이 같은 기준을 쓴다.
- 시간은 24시간제 HH:MM. "오전/오후"가 없는 1~6시는 오후(13:00~18:00)로 본다. 시간이 없으면 allDay=true.
- members에는 위 구성원 id만 쓴다. 메시지에 사람이 없으면 비워 둔다.
- title은 짧은 명사구(예: "치과", "가을 소풍"). 날짜·시간·사람 이름은 title에 넣지 않는다.
- "사야 돼", "사 와" 같은 물건은 task.add의 items에 list="shopping"으로, 해야 할 일은 list="todo"로 하나씩 나눈다.
- "샀어", "했어", "끝났어"는 task.done. 수정·삭제·완료는 위 목록에서 대상 id를 targetIds에 넣는다. 확실하지 않으면 후보를 모두 넣는다. 목록에 없으면 비워 둔다.
- 생일·기념일처럼 매년 반복되는 날은 anniversary.add, monthDay는 MM-DD.
- "뭐 있어?", "언제야?" 같은 물음은 question. 일정과 상관없는 말은 unknown.
- question이면 답을 쓰지 말고 범위만 채운다: qFrom·qTo(YYYY-MM-DD, 위 달력에서 찾기, 하루면 같은 값), qKinds(할 일·장보기를 묻는 것이 분명할 때만 tasks를 넣고, 그 밖에는 비운다. 날짜가 있는 질문의 일정·생일·기념일은 코드가 항상 포함한다. 값: events, tasks, anniversaries), qTense, qExcludeKeyword, qExcludeDates, qMembers(구성원 id; 자산 지도의 이름·부르는 이름으로 찾는다), qKeyword(메시지에 나온 일정 이름 단어, 없으면 비움).`;
}
