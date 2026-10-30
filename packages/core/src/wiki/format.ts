// 위키 마크다운 ↔ 도메인 타입. 형식은 family-wiki/CLAUDE.md와 MVP 스펙이 기준이다.
// 순수 함수만 둔다(파일 시스템 없음) — 대시보드·봇·테스트가 같이 쓴다.
import type { z } from "zod";
import type { Anniversary, Event, FamilyConfig, Member, MemberId, Task, TaskList } from "../types";
import { familyConfigSchema, memberSchema, shareGroupIdSchema } from "../schema";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ID_TOKEN = /\s+#((?:evt|task)-[A-Za-z0-9]+)\s*$/;
const SHARE_TOKEN = /\s+&(\S*)\s*$/;
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

/** 줄 끝의 &그룹 토큰을 떼어 낸다. 깨진 토큰(대문자 등)이나 2개 이상이면 share 없음 + 경고(줄은 살린다). */
function takeShare(rest: string, warn?: (m: string) => void): { text: string; share?: string } {
  const raw: string[] = [];
  let text = rest;
  for (let m = SHARE_TOKEN.exec(text); m; m = SHARE_TOKEN.exec(text)) {
    raw.unshift(m[1] ?? "");
    text = text.slice(0, m.index);
  }
  if (raw.length === 0) return { text };
  const ok = raw.length === 1 && shareGroupIdSchema.safeParse(raw[0]).success;
  if (!ok) warn?.(`share: "&${show(raw.join(" &"))}" 토큰이 올바르지 않아(소문자·숫자·_·-, 일정당 1개) 공유 없음으로 읽었어요`);
  return { text, share: ok ? raw[0] : undefined };
}

export function parseEventLine(line: string, warn?: (m: string) => void): Event | null {
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
  const { text: beforeShare, share } = takeShare(` ${restParts.join(" ")}`, warn);
  const { text, members } = takeMembers(beforeShare);
  if (!text) return null;
  return { id: c.id, date, start, end, allDay, title: text, members, ...(share ? { share } : {}), done: c.done };
}

export function formatEventLine(e: Event): string {
  const when = e.allDay || !e.start ? ALL_DAY : e.end ? `${e.start}-${e.end}` : e.start;
  const members = e.members.map((m) => ` @${m}`).join("");
  const share = e.share ? ` &${shareGroupIdSchema.parse(e.share)}` : "";
  return `- [${e.done ? "x" : " "}] ${e.date} ${when} ${e.title}${members}${share} #${e.id}`;
}

export function parseEventsFile(text: string, warn?: (m: string) => void): Event[] {
  return text.split(/\r?\n/).flatMap((l) => parseEventLine(l, warn) ?? []);
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

/** 읽기 경고: 값이 틀려서 기본값으로 대체했거나 파일을 건너뛴 일. 화면에는 안 내고 서버 로그에 남긴다. */
export type ReadWarn = (message: string) => void;

const show = (v: string) => (v.length > 40 ? `${v.slice(0, 40)}…` : v);

/**
 * 선택 필드 하나를 읽는다: 비어 있으면 fallback, 스키마에 안 맞으면 fallback + 경고.
 * 필드 단위 관용 읽기(스펙 rev 46): 값 하나가 틀려도 파일 전체를 버리지 않는다. 쓰기 스키마는 그대로 엄격하다.
 */
function lenient<S extends z.ZodType>(schema: S, raw: string | undefined, fallback: z.output<S> | undefined, key: string, warn?: ReadWarn) {
  if (raw === undefined || raw === "") return fallback;
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  warn?.(`${key}: "${show(raw)}" 값이 올바르지 않아 ${fallback === undefined ? "없는 것으로" : `기본값 ${String(fallback)}(으)로`} 읽었어요`);
  return fallback;
}

/** 구성원 파일. 필수값(id·name)이 깨지면 null(파일을 버림), 나머지 필드는 하나씩 기본값으로 대체. */
export function parseMemberFile(text: string, warn?: ReadWarn): Member | null {
  const fm = parseFrontmatter(text);
  if (!fm) {
    warn?.("프론트매터(---)가 없어 건너뛰었어요");
    return null;
  }
  const d = fm.data;
  const id = memberSchema.shape.id.safeParse(d.id ?? "");
  const name = memberSchema.shape.name.safeParse(d.name ?? "");
  if (!id.success || !name.success) {
    warn?.(`필수값 ${[!id.success && `id("${show(d.id ?? "")}")`, !name.success && `name("${show(d.name ?? "")}")`].filter(Boolean).join(", ")}이(가) 없거나 올바르지 않아 건너뛰었어요`);
    return null;
  }
  // 최소 권한 원칙(스펙 rev 51): role이 없거나 틀리면 child로 읽는다.
  const role = d.role?.trim();
  if (!role) warn?.("role이 없어 최소 권한인 child(으)로 읽었어요");
  else if (role !== "child" && role !== "guardian") warn?.(`role: "${show(role)}" 값이 올바르지 않아 최소 권한인 child(으)로 읽었어요`);
  return {
    id: id.data,
    name: name.data,
    role: role === "guardian" ? "guardian" : "child",
    birth: lenient(memberSchema.shape.birth.unwrap(), d.birth, undefined, "birth", warn),
    color: lenient(memberSchema.shape.color, d.color, "gray", "color", warn) ?? "gray",
    slackId: lenient(memberSchema.shape.slackId.unwrap(), d.slack, undefined, "slack", warn),
  };
}

/** 쓰기 전에 같은 스키마로 검증한다(잘못된 값이면 ZodError). */
export function formatMemberFile(m: Member): string {
  const v = memberSchema.parse(m);
  return stringifyFrontmatter({ id: v.id, name: v.name, role: v.role, birth: v.birth, color: v.color, slack: v.slackId });
}

function lenientInt(raw: string | undefined, key: string, warn?: ReadWarn): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  warn?.(`${key}: "${show(raw)}" 값이 정수가 아니라 없는 것으로 읽었어요`);
  return undefined;
}

/** config.md. 필수값(familyName)이 깨지면 null(→ 세팅 필요), 나머지 필드는 하나씩 기본값으로 대체. */
export function parseConfigFile(text: string, warn?: ReadWarn): FamilyConfig | null {
  const fm = parseFrontmatter(text);
  if (!fm) {
    warn?.("프론트매터(---)가 없어 config로 읽지 못했어요");
    return null;
  }
  const d = fm.data;
  const familyName = familyConfigSchema.shape.familyName.safeParse(d.familyName ?? "");
  if (!familyName.success) {
    warn?.(`필수값 familyName("${show(d.familyName ?? "")}")이 없거나 올바르지 않아 config를 읽지 못했어요`);
    return null;
  }
  const sh = familyConfigSchema.shape;
  // setupCompletedAt이 깨져도 세팅 필요(QR 화면)로 바뀌지 않는다: needsSetup은 config가 읽히는지와 구성원 수만 본다.
  return {
    familyName: familyName.data,
    timezone: lenient(sh.timezone, d.timezone, "Asia/Seoul", "timezone", warn) ?? "Asia/Seoul",
    region: lenient(sh.region.unwrap(), d.region, undefined, "region", warn),
    kmaNx: lenientInt(d.kmaNx, "kmaNx", warn),
    kmaNy: lenientInt(d.kmaNy, "kmaNy", warn),
    kmaMidLandRegId: lenient(sh.kmaMidLandRegId.unwrap(), d.kmaMidLandRegId, undefined, "kmaMidLandRegId", warn),
    kmaMidTaRegId: lenient(sh.kmaMidTaRegId.unwrap(), d.kmaMidTaRegId, undefined, "kmaMidTaRegId", warn),
    familyColor: lenient(sh.familyColor, d.familyColor, "gray", "familyColor", warn) ?? "gray",
    calendarId: lenient(sh.calendarId.unwrap(), d.calendarId, undefined, "calendarId", warn),
    setupCompletedAt: lenient(sh.setupCompletedAt.unwrap(), d.setupCompletedAt, undefined, "setupCompletedAt", warn),
  };
}

export function formatConfigFile(c: FamilyConfig): string {
  return stringifyFrontmatter({ ...familyConfigSchema.parse(c) });
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
