// 의도 추출 프롬프트. 상대 날짜 실수를 줄이려고 "오늘부터 3주 달력"을 표로 넣어 LLM이 계산 대신 찾게 한다.
import { WEEKDAYS_KO, addDays, weekdayOf, type Event, type Member, type Task } from "@hsh/core";
import { z } from "zod";

export interface PromptContext {
  today: string;
  now: string;
  sender?: Member;
  members: Member[];
  events: Event[];
  tasks: Task[];
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
  qFrom: z.string().optional(),
  qTo: z.string().optional(),
  qKinds: z.array(z.enum(["events", "tasks", "anniversaries"])).optional(),
  qMembers: z.array(z.string()).optional(),
  qKeyword: z.string().optional(),
});
export type LlmOutput = z.infer<typeof llmOutputSchema>;
export const llmOutputJsonSchema: Record<string, unknown> = z.toJSONSchema(llmOutputSchema);

function calendarTable(today: string): string {
  // 이번 주 일요일부터 3주 (rev 62: 주는 일~토)
  const sunday = addDays(today, -weekdayOf(today));
  const labels = ["이번 주", "다음 주", "다다음 주"];
  return labels
    .map((label, w) => {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(sunday, w * 7 + i);
        return `${WEEKDAYS_KO[weekdayOf(d)]} ${d}${d === today ? "(오늘)" : ""}`;
      });
      return `- ${label}: ${days.join(", ")}`;
    })
    .join("\n");
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const members = ctx.members.map((m) => `- ${m.id}: ${m.name}${m.id === "family" ? " (가족 전체)" : ""}`).join("\n");
  const events = ctx.events
    .filter((e) => e.date >= ctx.today)
    .slice(0, 40)
    .map((e) => `- ${e.id}: ${e.date} ${e.allDay ? "종일" : (e.start ?? "")} ${e.title} (${e.members.join(",")})`)
    .join("\n");
  const tasks = ctx.tasks
    .filter((t) => !t.done)
    .map((t) => `- ${t.id}: [${t.list === "shopping" ? "장보기" : "할 일"}] ${t.title}`)
    .join("\n");

  return `너는 가족 일정 비서다. 가족이 보낸 한국어 메시지 하나를 읽고 의도와 필드를 JSON으로만 답한다.
파일을 쓰거나 답장을 만들지 않는다. 모르는 것은 지어내지 않는다.

## 지금
- 오늘: ${ctx.today} (${WEEKDAYS_KO[weekdayOf(ctx.today)]}요일), 현재 시각 ${ctx.now}, 시간대 Asia/Seoul
- 보낸 사람: ${ctx.sender ? `${ctx.sender.id} (${ctx.sender.name})` : "알 수 없음"}

## 달력 (주는 일요일 시작, 대시보드 달력과 같다. 예외: "이번 주 일요일"은 돌아오는 일요일(오늘이 일요일이면 오늘), "다음 주 일요일"은 그다음 일요일. "다음 주 화요일" = 아래 '다음 주' 줄의 화요일)
${calendarTable(ctx.today)}

## 구성원
${members || "- (없음)"}

## 앞으로의 일정
${events || "- (없음)"}

## 남은 할 일·장보기
${tasks || "- (없음)"}

## 규칙
- intent는 event.add, event.update, event.remove, task.add, task.done, anniversary.add, question, unknown 중 하나.
- 날짜는 위 달력에서 찾아 YYYY-MM-DD로. 요일만 말하면 오늘 이후 가장 가까운 그 요일. "내일" = 오늘+1일, "모레" = 오늘+2일.
- 시간은 24시간제 HH:MM. "오전/오후"가 없는 1~6시는 오후(13:00~18:00)로 본다. 시간이 없으면 allDay=true.
- members에는 위 구성원 id만 쓴다. 메시지에 사람이 없으면 비워 둔다.
- title은 짧은 명사구(예: "치과", "가을 소풍"). 날짜·시간·사람 이름은 title에 넣지 않는다.
- "사야 돼", "사 와" 같은 물건은 task.add의 items에 list="shopping"으로, 해야 할 일은 list="todo"로 하나씩 나눈다.
- "샀어", "했어", "끝났어"는 task.done. 수정·삭제·완료는 위 목록에서 대상 id를 targetIds에 넣는다. 확실하지 않으면 후보를 모두 넣는다. 목록에 없으면 비워 둔다.
- 생일·기념일처럼 매년 반복되는 날은 anniversary.add, monthDay는 MM-DD.
- "뭐 있어?", "언제야?" 같은 물음은 question. 일정과 상관없는 말은 unknown.
- question이면 답을 쓰지 말고 범위만 채운다: qFrom·qTo(YYYY-MM-DD, 위 달력에서 찾기, 하루면 같은 값), qKinds(할 일·장보기를 묻는 것이 분명할 때만 tasks를 넣고, 그 밖에는 비운다. 날짜가 있는 질문의 일정·생일·기념일은 코드가 항상 포함한다. 값: events, tasks, anniversaries), qMembers(구성원 id), qKeyword(메시지에 나온 일정 이름 단어, 없으면 비움).`;
}
