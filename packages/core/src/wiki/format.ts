// 위키 마크다운 ↔ 도메인 타입. 형식은 family-wiki/CLAUDE.md와 MVP 스펙이 기준이다.
// 순수 함수만 둔다(파일 시스템 없음) — 대시보드·봇·테스트가 같이 쓴다.
import type { Anniversary, Event, FamilyConfig, Member, MemberId, Task, TaskList } from "../types";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ID_TOKEN = /\s+#((?:evt|task)-[A-Za-z0-9]+)\s*$/;
const MEMBER_TOKEN = /\s+@([A-Za-z0-9_-]+)\s*$/;
const ALL_DAY = "종일";

export const isDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
};
export const isTime = (s: string) => TIME.test(s);
export const isMonthDay = (s: string) => MONTH_DAY.test(s);

/** 줄 끝의 @멤버 토큰들을 떼어 낸다 (순서 유지). */
function takeMembers(rest: string): { text: string; members: MemberId[] } {
  const members: MemberId[] = [];
  let text = rest;
  for (let m = MEMBER_TOKEN.exec(text); m; m = MEMBER_TOKEN.exec(text)) {
    members.unshift(m[1] ?? "");
    text = text.slice(0, m.index);
  }
  return { text: text.trim(), members };
}

/** 체크박스 줄: `- [ ] 본문 #id` → { done, body, id } */
function parseCheckLine(line: string): { done: boolean; body: string; id?: string } | null {
  const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
  if (!m) return null;
  let body = m[2] ?? "";
  let id: string | undefined;
  const idm = ID_TOKEN.exec(body);
  if (idm) {
    id = idm[1];
    body = body.slice(0, idm.index);
  }
  return { done: m[1] !== " ", body: body.trim(), id };
}

// ---------- 일정 ----------

export function parseEventLine(line: string): Event | null {
  const c = parseCheckLine(line);
  if (!c?.id?.startsWith("evt-")) return null;
  const [date, when, ...restParts] = c.body.split(/\s+/);
  if (!date || !isDate(date) || !when) return null;
  let start: string | undefined;
  let end: string | undefined;
  let allDay = false;
  if (when === ALL_DAY) allDay = true;
  else {
    const [s, e] = when.split("-");
    if (!s || !isTime(s) || (e !== undefined && !isTime(e))) return null;
    start = s;
    end = e;
  }
  const { text, members } = takeMembers(` ${restParts.join(" ")}`);
  if (!text) return null;
  return { id: c.id, date, start, end, allDay, title: text, members, done: c.done };
}

export function formatEventLine(e: Event): string {
  const when = e.allDay || !e.start ? ALL_DAY : e.end ? `${e.start}-${e.end}` : e.start;
  const members = e.members.map((m) => ` @${m}`).join("");
  return `- [${e.done ? "x" : " "}] ${e.date} ${when} ${e.title}${members} #${e.id}`;
}

export function parseEventsFile(text: string): Event[] {
  return text.split(/\r?\n/).flatMap((l) => parseEventLine(l) ?? []);
}

export const eventSortKey = (e: Pick<Event, "date" | "start" | "allDay">) =>
  `${e.date} ${e.allDay || !e.start ? "00:00" : e.start}`;

export const eventFileOf = (date: string) => `events/${date.slice(0, 7)}.md`;

// ---------- 할 일 ----------

const SECTION: Record<string, TaskList> = { 장보기: "shopping", "할 일": "todo" };
export const SECTION_TITLE: Record<TaskList, string> = { shopping: "장보기", todo: "할 일" };

export function parseTasksFile(text: string): Task[] {
  const tasks: Task[] = [];
  let list: TaskList | undefined;
  for (const line of text.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      list = SECTION[h[1] ?? ""];
      continue;
    }
    if (!list) continue;
    const c = parseCheckLine(line);
    if (!c?.id?.startsWith("task-")) continue;
    const { text: title, members } = takeMembers(` ${c.body}`);
    if (!title) continue;
    tasks.push({ id: c.id, list, title, member: members[0], done: c.done });
  }
  return tasks;
}

export function formatTaskLine(t: Task): string {
  return `- [${t.done ? "x" : " "}] ${t.title}${t.member ? ` @${t.member}` : ""} #${t.id}`;
}

// ---------- 기념일 ----------

export function parseAnniversaryLine(line: string): Anniversary | null {
  const m = /^\s*[-*]\s+(\d{2}-\d{2})\s+(.+)$/.exec(line);
  if (!m || !isMonthDay(m[1] ?? "")) return null;
  const { text, members } = takeMembers(` ${m[2] ?? ""}`);
  if (!text) return null;
  return { monthDay: m[1] ?? "", title: text, member: members[0] };
}

export function formatAnniversaryLine(a: Anniversary): string {
  return `- ${a.monthDay} ${a.title}${a.member ? ` @${a.member}` : ""}`;
}

export function parseAnniversariesFile(text: string): Anniversary[] {
  return text.split(/\r?\n/).flatMap((l) => parseAnniversaryLine(l) ?? []);
}

// ---------- 구성원 · config ----------

export function parseMemberFile(text: string): Member | null {
  const fm = parseFrontmatter(text);
  if (!fm) return null;
  const { id, name, role, birth, color, slack } = fm.data;
  if (!id || !name) return null;
  return {
    id,
    name,
    role: role === "child" ? "child" : "guardian",
    birth: birth && isDate(birth) ? birth : undefined,
    color: color || "gray",
    slackId: slack || undefined,
  };
}

export function formatMemberFile(m: Member): string {
  return stringifyFrontmatter({ id: m.id, name: m.name, role: m.role, birth: m.birth, color: m.color, slack: m.slackId });
}

const num = (s?: string) => (s && /^-?\d+$/.test(s) ? Number(s) : undefined);

export function parseConfigFile(text: string): FamilyConfig | null {
  const fm = parseFrontmatter(text);
  if (!fm?.data.familyName) return null;
  const d = fm.data;
  return {
    familyName: d.familyName ?? "",
    timezone: d.timezone || "Asia/Seoul",
    region: d.region || undefined,
    kmaNx: num(d.kmaNx),
    kmaNy: num(d.kmaNy),
    kmaMidLandRegId: d.kmaMidLandRegId || undefined,
    kmaMidTaRegId: d.kmaMidTaRegId || undefined,
    familyColor: d.familyColor || "gray",
    calendarId: d.calendarId || undefined,
    setupCompletedAt: d.setupCompletedAt || undefined,
  };
}

export function formatConfigFile(c: FamilyConfig): string {
  return stringifyFrontmatter({ ...c });
}

/** 내장 구성원 '가족 전체' */
export function familyMember(config?: FamilyConfig): Member {
  return { id: "family", name: "가족", role: "guardian", color: config?.familyColor ?? "gray" };
}

/** 체크박스 줄의 #id만 꺼낸다. */
export function parseCheckId(line: string): string | undefined {
  return parseCheckLine(line)?.id;
}

/** tasks.md의 i번째 줄을 그 줄이 속한 섹션을 찾아 Task로 읽는다. */
export function parseTaskLineIn(lines: string[], i: number): Task | null {
  let start = i;
  while (start > 0 && !/^##\s/.test(lines[start] ?? "")) start--;
  const section = [lines[start] ?? "", lines[i] ?? ""].join("\n");
  return parseTasksFile(section)[0] ?? null;
}
