// 질문 응답. LLM은 질문을 구조화 필드로만 바꾸고, 답 문장은 코드가 위키 항목으로 결정적으로 조립한다.
// 지어내지 않는 방법: 답에 쓰는 글자는 (1) 위키 항목의 제목·시간·구성원 이름, (2) 이 파일의 고정 문장뿐이다.
// LLM이 준 id·제목·본문은 답에 전혀 들어가지 않는다(필드는 범위·종류·키워드 필터로만 쓰이고, 키워드는 사용자 원문에 있어야 한다).
import {
  addDays,
  diffDays,
  isDate,
  nextOccurrence,
  resolveDateRange,
  weekdayKo,
  type Anniversary,
  type DateRange,
  type Event,
  type Member,
  type Task,
} from "@hsh/core";
import type { LlmOutput } from "./prompt";

export type QuestionTarget = "events" | "tasks" | "anniversaries";

/** 코드가 검증·보정한 질문. 날짜는 모두 절대 날짜(서울 기준). */
export interface Question {
  /** 일정·기념일을 볼 기간. 할 일만 묻는 질문엔 없다 */
  range?: DateRange;
  targets: QuestionTarget[];
  /** 장보기/할 일 중 하나만 물었을 때 */
  taskList?: "shopping" | "todo";
  /** 사용자 원문에 이름이 나온 구성원 id */
  memberIds: string[];
  /** 사용자 원문에 실제로 있는 단어만 */
  keyword?: string;
}

export interface WikiFacts {
  members: Member[];
  events: Event[];
  tasks: Task[];
  anniversaries: Anniversary[];
}

export const NO_ANSWER = "잘 모르겠어요. 일정·할 일·기념일에 대해 다시 물어봐 주세요.";

/** LLM 값을 쓸 수 있는 날짜 범위: 오늘-366일 ~ 오늘+400일, 길이 366일 이하 */
const LLM_WINDOW = { past: -366, future: 400, span: 366 };
const DEFAULT_DAYS = 7;
/** "언제야?"처럼 날짜 없이 다음 날을 묻거나 기념일만 물을 때 보는 기간(기념일은 다음 돌아오는 날 기준) */
const WHEN_DAYS = 365;
const MAX_LINES = 20;
/** keyword에서 뺄 토큰: 날짜·요일·기간·서술어·종류 이름. 항목 이름(치과, 미술학원)만 필터로 쓴다 */
const NON_KEYWORD =
  /[일월화수목금토]요일|오늘|내일|모레|글피|어제|이번|다음|지난|저번|주말|^주$|^달$|\d+(월|일|년|주)|^있[어나니는]|^있었|^뭐|^언제|^알려|^보여|^말해|일정|약속|스케줄|^할일$|^할$|^일$|장보기|생일|기념일|^있$|^없/;

function cleanKeyword(raw: string | undefined, text: string, members: Member[], titles: string[]): string | undefined {
  const kept = (raw ?? "")
    .split(/\s+/)
    .filter((t) => t && !NON_KEYWORD.test(t));
  const kw = kept.join(" ").trim();
  if (kw.length < 2 || !text.includes(kw) || members.some((m) => m.name === kw)) return undefined;
  // 위키 어디에도 없는 단어면 필터로 쓰지 않는다(없는 일정이 '없어요'로 둔갑하지 않게)
  return titles.some((t) => t.includes(kw)) ? kw : undefined;
}

export function buildQuestion(
  o: LlmOutput,
  text: string,
  today: string,
  members: Member[],
  senderId?: string,
  titles: string[] = [],
): Question {
  const s = text.replace(/\s+/g, "");
  const wantsTasks = /장보기|살것|사야|할일|해야할|투두|todo/i.test(s);
  const wantsShopping = /장보기|살것|사야/.test(s);
  const wantsAnniv = /생일|기념일/.test(s);
  const wantsEvents = /일정|약속|스케줄/.test(s);
  const codeRange = resolveDateRange(text, today);

  // 대상 종류: 사용자 원문 단서 > LLM targets > 기본(일정+기념일)
  let targets: QuestionTarget[];
  if (wantsTasks && !wantsEvents && !wantsAnniv) targets = ["tasks"];
  else if (wantsAnniv && !wantsEvents && !wantsTasks) targets = ["anniversaries"];
  else if (wantsEvents && !wantsTasks) targets = ["events", "anniversaries"];
  else if (!wantsTasks && !wantsAnniv) {
    const fromLlm = (o.targets ?? []).filter((t): t is QuestionTarget => t === "events" || t === "tasks" || t === "anniversaries");
    targets = fromLlm.length ? [...new Set(fromLlm)] : ["events", "anniversaries"];
    // 원문에서 날짜를 계산했고 종류 단서가 없으면 LLM targets와 상관없이 그날 일정은 항상 보여 준다
    if (codeRange && !wantsEvents && !targets.includes("events")) targets = ["events", ...targets];
  } else targets = [...(wantsEvents ? (["events"] as const) : []), ...(wantsTasks ? (["tasks"] as const) : []), ...(wantsAnniv ? (["anniversaries"] as const) : [])];

  const taskList: Question["taskList"] =
    targets.includes("tasks") && targets.length === 1 ? (wantsShopping ? "shopping" : /할일|해야할|투두|todo/i.test(s) ? "todo" : undefined) : undefined;

  const memberIds = members.filter((m) => m.id !== "family" && (text.includes(m.name) || (m.id !== m.name && containsWord(text, m.id)))).map((m) => m.id);
  if (/(^|\s)(나|내|제)(\s|가|의|$)/.test(text) && senderId && !memberIds.includes(senderId)) memberIds.push(senderId);

  const keyword = cleanKeyword(o.keyword, text, members, titles);

  // 기간: 코드가 원문에서 계산한 값이 LLM 값보다 우선.
  // 둘 다 없으면 "언제"를 묻거나 기념일만 물을 땐 365일, 키워드가 있으면 400일, 아니면 앞으로 7일.
  let range: DateRange | undefined;
  if (targets.some((t) => t !== "tasks")) {
    range = codeRange ?? llmRange(o, today);
    if (!range) {
      const whenAsked = /언제/.test(s) || (targets.length === 1 && targets[0] === "anniversaries");
      range = { from: today, to: addDays(today, whenAsked ? WHEN_DAYS : keyword ? 400 : DEFAULT_DAYS - 1) };
    }
  }
  return { range, targets, taskList, memberIds, keyword };
}

function containsWord(text: string, w: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/gi, "")}([^a-z0-9]|$)`, "i").test(text);
}

function llmRange(o: LlmOutput, today: string): DateRange | undefined {
  const from = o.from ?? o.to;
  const to = o.to ?? o.from;
  if (!from || !to || !isDate(from) || !isDate(to) || from > to) return undefined;
  const a = diffDays(today, from);
  const b = diffDays(today, to);
  if (a < LLM_WINDOW.past || b > LLM_WINDOW.future || diffDays(from, to) + 1 > LLM_WINDOW.span) return undefined;
  return { from, to };
}

// ---------- 답 조립 ----------

/** 이 해가 아니면 연도를 붙인다: "2027년 8/15(일)" */
const mdOf = (today: string) => (d: string) =>
  `${d.slice(0, 4) === today.slice(0, 4) ? "" : `${d.slice(0, 4)}년 `}${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${weekdayKo(d)})`;
/** 받침이 있으면 이, 없으면 가 */
const iga = (w: string) => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 0 ? "이" : "가");

export function composeAnswer(q: Question, wiki: WikiFacts, today: string): string {
  const md = mdOf(today);
  const rangeLabel = (r: DateRange) => (r.from === r.to ? md(r.from) : `${md(r.from)}~${md(r.to)}`);
  const nameOf = (id: string) => wiki.members.find((m) => m.id === id)?.name ?? "";
  const who = (ids: string[]) => ids.map(nameOf).filter(Boolean).join("·");
  const matchKw = (title: string) => !q.keyword || title.includes(q.keyword);
  const matchMember = (ids: string[]) => !q.memberIds.length || ids.some((id) => id === "family" || q.memberIds.includes(id));
  const sections: string[] = [];
  const subject = [q.memberIds.map(nameOf).filter(Boolean).join("·"), q.keyword ? `'${q.keyword}'` : ""].filter(Boolean).join(" ");

  if (q.range && (q.targets.includes("events") || q.targets.includes("anniversaries"))) {
    const range = q.range;
    const lines: { date: string; sort: string; text: string }[] = [];
    if (q.targets.includes("events")) {
      for (const e of wiki.events) {
        if (e.date < range.from || e.date > range.to || !matchKw(e.title) || !matchMember(e.members)) continue;
        const names = who(e.members);
        lines.push({
          date: e.date,
          sort: e.allDay || !e.start ? "00:00" : e.start,
          text: `${e.allDay || !e.start ? "종일" : `${e.start}${e.end ? `-${e.end}` : ""}`} ${e.title}${names ? ` (${names})` : ""}${e.done ? " - 완료" : ""}`,
        });
      }
    }
    if (q.targets.includes("anniversaries")) {
      for (const a of wiki.anniversaries) {
        if (!matchKw(a.title) || !matchMember(a.member ? [a.member] : [])) continue;
        const d = nextOccurrence(a.monthDay, range.from);
        if (d > range.to) continue;
        const names = a.member ? who([a.member]) : "";
        lines.push({ date: d, sort: "00:00", text: `🎉 ${a.title}${names ? ` (${names})` : ""}` });
      }
    }
    lines.sort((x, y) => x.date.localeCompare(y.date) || x.sort.localeCompare(y.sort));
    const label = rangeLabel(range);
    const what = q.targets.length === 1 && q.targets[0] === "anniversaries" ? "기념일" : "일정";
    if (!lines.length) {
      sections.push(`${label}${subject ? ` ${subject}` : ""} ${what}은 위키에 없어요.`);
    } else {
      const shown = lines.slice(0, MAX_LINES);
      const body: string[] = [];
      let last = "";
      for (const l of shown) {
        if (range.from !== range.to && l.date !== last) body.push(md(l.date));
        last = l.date;
        body.push(`- ${l.text}`);
      }
      const more = lines.length > shown.length ? `\n…외 ${lines.length - shown.length}건` : "";
      sections.push(`${label}${subject ? ` ${subject}` : ""} ${what} ${lines.length}건이에요.\n${body.join("\n")}${more}`);
    }
  }

  if (q.targets.includes("tasks")) {
    const open = wiki.tasks.filter(
      (t) => !t.done && (!q.taskList || t.list === q.taskList) && matchKw(t.title) && matchMember(t.member ? [t.member] : []),
    );
    const name = q.taskList === "shopping" ? "장보기" : q.taskList === "todo" ? "할 일" : "장보기·할 일";
    if (!open.length) sections.push(`${subject ? `${subject} ` : ""}남은 ${name}${iga(name)} 위키에 없어요.`);
    else {
      const shown = open.slice(0, MAX_LINES);
      const lines = shown.map((t) => `- ${q.taskList ? "" : `[${t.list === "shopping" ? "장보기" : "할 일"}] `}${t.title}${t.member ? ` (${who([t.member])})` : ""}`);
      sections.push(`남은 ${name} ${open.length}개예요.\n${lines.join("\n")}${open.length > shown.length ? `\n…외 ${open.length - shown.length}개` : ""}`);
    }
  }
  return sections.length ? sections.join("\n\n") : NO_ANSWER;
}
