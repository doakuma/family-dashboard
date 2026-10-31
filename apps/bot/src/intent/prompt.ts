// 의도 추출 프롬프트. 날짜·시제·"말고" 판단은 LLM이 한다(MVP 스펙 rev 63). 코드는 결과를 검증만 한다.
// 모자란 지식은 자산 지도(달력표·구성원 부르는 이름·일정/기념일 제목 관계)로 보충하고, rev 62 규칙을 판단 기준으로 명시한다.
import { WEEKDAYS_KO, buildAssetMap, buildDateGuide, weekdayOf, type Anniversary, type Event, type Member, type Task } from "@hsh/core";
import { z } from "zod";

export interface PromptContext {
  today: string;
  now: string;
  sender?: Member;
  members: Member[];
  events: Event[];
  tasks: Task[];
  anniversaries?: Anniversary[];
  /** 자산 지도 글자 수 상한(기본 5000). 프롬프트 전체 상한을 넘으면 더 줄어든다 */
  assetMapChars?: number;
  /** 프롬프트 전체 글자 수 상한(기본 PROMPT_MAX_CHARS) */
  maxChars?: number;
}

/** 프롬프트 전체 상한(글자). Ollama 문맥(기본 num_ctx 8192 토큰)에 들어가게 자산 지도·일정·할 일을 이 안에서 줄인다. */
export const PROMPT_MAX_CHARS = 8000;
const EVENTS_LIMIT = 25;
const EVENTS_SHRUNK = 10;
const TASKS_LIMIT = 20;
const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

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
  /** 메시지 속 날짜 표현을 그대로 옮긴 것("다음 주 화요일"), 없으면 "". 모델이 날짜를 풀이표에서 찾기 전에 먼저 적게 한다. 코드는 쓰지 않는다 */
  qDatePhrase: z.string().optional(),
  /** 시제를 먼저 정하게 qFrom보다 앞에 둔다: past = 과거형("뭐 했어?"·"있었지?"), nonpast = 그 외, none = 날짜 표현 없음. 없거나 none이면 없는 것으로 본다 */
  qTense: z.enum(["past", "nonpast", "none"]).optional(),
  /** "A 말고 B"의 A가 일정 이름이면 제외할 단어, 날짜면 제외할 날짜(YYYY-MM-DD). 실제 질문 범위는 B */
  qExcludeKeyword: z.string().optional(),
  qExcludeDates: z.array(z.string()).optional(),
  /** question: 묻는 범위. 답 문장은 코드가 위키에서 만들므로 범위만 뽑는다 */
  qFrom: z.string().optional(),
  qTo: z.string().optional(),
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
  qKinds: z.array(z.enum(["events", "tasks", "anniversaries"])).optional(),
  qMembers: z.array(z.string()).optional(),
  qKeyword: z.string().optional(),
});
export type LlmOutput = z.infer<typeof llmOutputSchema>;
/** 모델에 보내는 JSON 스키마: 날짜 판단 칸을 반드시 채우게 required로 바꾼다. 파서(llmOutputSchema)는 관대해서 없거나 ""이면 없는 것으로 본다. */
export const LLM_REQUIRED_FIELDS = ["intent", "qDatePhrase", "qTense"] as const;
export const llmOutputJsonSchema: Record<string, unknown> = { ...z.toJSONSchema(llmOutputSchema), required: [...LLM_REQUIRED_FIELDS] };

/** 프롬프트 전체가 상한 안에 들도록 일정 목록 -> 자산 지도(날짜 풀이표는 남김) -> 할 일 순으로 줄인다. */
export function buildSystemPrompt(ctx: PromptContext): string {
  const max = ctx.maxChars ?? PROMPT_MAX_CHARS;
  let mapChars = ctx.assetMapChars ?? 5000;
  // 날짜 풀이표(+구성원 한 줄)보다 작게는 줄이지 않는다. 이 표가 날짜 판단의 핵심이다.
  const mapFloor = buildDateGuide(ctx.today).length + 700;
  let evN = EVENTS_LIMIT;
  let tkN = TASKS_LIMIT;
  let out = renderPrompt(ctx, mapChars, evN, tkN);
  while (out.length > max && (evN > EVENTS_SHRUNK || mapChars > mapFloor || tkN > 5 || evN > 5)) {
    if (evN > EVENTS_SHRUNK) evN = EVENTS_SHRUNK;
    else if (mapChars > mapFloor) mapChars = Math.max(mapFloor, mapChars - Math.max(300, out.length - max));
    else if (tkN > 5) tkN = Math.max(5, tkN - 5);
    else evN = 5;
    out = renderPrompt(ctx, mapChars, evN, tkN);
  }
  return out;
}

function renderPrompt(ctx: PromptContext, mapChars: number, evN: number, tkN: number): string {
  // 쓰기 대상 id가 필요해 자산 지도와 겹쳐도 남긴다. 날짜·시각순으로 정렬한 뒤 건수·제목 길이를 제한한다.
  const events = ctx.events
    .filter((e) => e.date >= ctx.today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.allDay ? "" : (a.start ?? "")).localeCompare(b.allDay ? "" : (b.start ?? "")))
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

## 앞으로의 일정 (수정·삭제 대상 id)
${events || "- (없음)"}

## 남은 할 일·장보기
${tasks || "- (없음)"}

## 날짜 판단 기준
- 날짜는 위 날짜 풀이표에서 그대로 찾아 YYYY-MM-DD로 쓴다. 직접 세지 않는다. 쓰기(event.add 등)와 질문(qFrom·qTo)이 같은 기준을 쓴다.
- 먼저 qDatePhrase에 메시지 속 날짜 표현을 그대로 옮긴다(없으면 ""). 그다음 qTense: 과거형("뭐 했어?"·"있었지?")이면 past, 아니면 nonpast, 날짜 표현이 없으면 none.
- "주"는 일~토 7일, "주말"은 토·일이다. 주를 물으면 주 범위, 주말을 물으면 주말 범위로 쓰고 섞지 않는다.
- 요일만·"M월 D일"·"M월"은 풀이표의 다가오는 값(과거형이면 과거형 값)을 쓴다. 연도를 말하면 그대로 쓴다.
- 범위는 최대 62일. "A랑 B"처럼 떨어진 날짜는 qFrom·qTo를 비운다.
- "언제야?"·"언제 가?"처럼 날짜를 묻는 질문은 qFrom·qTo를 비운다.
- "A 말고 B": A는 제외 칸에만 넣고(날짜·요일이면 qExcludeDates, 일정 이름이면 qExcludeKeyword) 범위와 qKeyword는 B로 잡는다. 같은 단어를 qKeyword와 제외에 함께 넣지 않는다. B에 날짜가 없으면 qFrom·qTo를 비운다. 단 "토요일에 핼러윈 말고"처럼 날짜가 이름과 함께 있으면 그 날짜가 범위이고 이름만 제외다.
- YYYY-MM-DD만 있는 메시지도 묻는 말이면 question이다.

## 규칙
- intent는 event.add, event.update, event.remove, task.add, task.done, anniversary.add, question, unknown 중 하나.
- 시간은 24시간제 HH:MM. "오전/오후"가 없는 1~6시는 오후(13:00~18:00)로 본다. 시간이 없으면 allDay=true.
- members에는 자산 지도의 구성원 id만 쓴다. 메시지에 사람이 없으면 비워 둔다.
- title은 짧은 명사구(예: "치과", "가을 소풍"). 날짜·시간·사람 이름은 title에 넣지 않는다.
- "사야 돼", "사 와" 같은 물건은 task.add의 items에 list="shopping"으로, 해야 할 일은 list="todo"로 하나씩 나눈다.
- "샀어", "했어", "끝났어"는 task.done. 수정·삭제·완료는 위 목록에서 대상 id를 targetIds에 넣는다. 확실하지 않으면 후보를 모두 넣는다. 목록에 없으면 비워 둔다.
- 생일·기념일처럼 매년 반복되는 날은 anniversary.add, monthDay는 MM-DD.
- "뭐 있어?", "언제야?" 같은 물음은 question. 일정과 상관없는 말은 unknown.
- question이면 답을 쓰지 말고 범위만 채운다: qFrom·qTo(풀이표에서 찾기, 하루면 같은 값), qKinds(할 일·장보기를 묻는 것이 분명할 때만 tasks를 넣고, 그 밖에는 비운다. 날짜가 있는 질문의 일정·생일·기념일은 코드가 항상 포함한다. 값: events, tasks, anniversaries), qExcludeKeyword, qExcludeDates, qMembers(메시지에 사람 이름·호칭이 나올 때만, 자산 지도의 이름·부르는 이름으로 id를 찾는다. 없으면 []), qKeyword(메시지에 일정 이름이 나올 때만. "일정"·요일·달·날짜 말은 keyword가 아니다. 없으면 "").`;
}
