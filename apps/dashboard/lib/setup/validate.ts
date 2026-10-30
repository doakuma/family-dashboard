// 단계별 입력 검증. 메시지는 한국어로 필드 옆에 보여 준다(필드 키 -> 메시지).
// 최종 방어선은 서버의 setupSchema(@hsh/core)이고, 여기서 통과한 값은 그 스키마도 통과해야 한다(테스트로 확인).
import { CALENDAR_ID_RE, CONTROL_CHARS, KMA_NX_RANGE, KMA_NY_RANGE, KMA_REG_ID_RE, SETUP_MAX_MEMBERS, familyConfigSchema, findRegion, isDate } from "@hsh/core";
import { isPickableColor } from "./colors";
import type { AnnivDraft, Draft, MemberDraft } from "./draft";

export type Errors = Record<string, string>;

/** 필드 키 규칙: familyName · region · manual.<x> · timezone · members · member.<key>.<x> · anniv.<key>.<x> · calendarId · form */
export const fieldId = (field: string) => `f-${field.replace(/[^A-Za-z0-9_-]+/g, "-")}`;

const quoted = (s: string) => /^(["']).*\1$/.test(s);

/** 이름·제목 공통: 위키 한 줄에 들어가는 문자열 */
function lineText(value: string, label: string, max: number): string | undefined {
  const v = value.trim();
  if (!v) return `${label}을(를) 입력해 주세요`;
  if (v.length > max) return `${max}자 이하로 입력해 주세요`;
  if (CONTROL_CHARS.test(v)) return "줄바꿈 같은 제어 문자는 쓸 수 없어요";
  if (quoted(v)) return "따옴표로 감싼 값은 쓸 수 없어요";
  return undefined;
}

const int = (s: string) => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : undefined);

export function validateHome(d: Draft): Errors {
  const e: Errors = {};
  const name = lineText(d.familyName, "가족 이름", 40);
  if (name) e.familyName = name;

  if (d.regionMode === "list") {
    if (!findRegion(d.regionKey)) e.region = "지역을 골라 주세요";
  } else {
    const m = d.manual;
    const label = lineText(m.label, "지역 이름", 80);
    if (label) e["manual.label"] = label;
    const nx = int(m.nx);
    if (nx === undefined || nx < KMA_NX_RANGE[0] || nx > KMA_NX_RANGE[1]) e["manual.nx"] = `nx는 ${KMA_NX_RANGE[0]}~${KMA_NX_RANGE[1]} 사이 숫자예요`;
    const ny = int(m.ny);
    if (ny === undefined || ny < KMA_NY_RANGE[0] || ny > KMA_NY_RANGE[1]) e["manual.ny"] = `ny는 ${KMA_NY_RANGE[0]}~${KMA_NY_RANGE[1]} 사이 숫자예요`;
    if (!KMA_REG_ID_RE.test(m.landId.trim())) e["manual.landId"] = "육상 예보구역 코드는 11B00000 같은 모양이에요";
    if (!KMA_REG_ID_RE.test(m.taId.trim())) e["manual.taId"] = "기온 지점 코드는 11B10101 같은 모양이에요";
  }

  if (!familyConfigSchema.shape.timezone.safeParse(d.timezone.trim()).success) e.timezone = "알 수 없는 시간대예요 (예: Asia/Seoul)";
  return e;
}

const todayOf = (now: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);

export function validateMembers(d: Draft, now: Date = new Date()): Errors {
  const e: Errors = {};
  const today = todayOf(now);
  const seen = new Map<string, string>(); // 소문자 id -> 첫 구성원 key
  for (const m of d.members) {
    const k = `member.${m.key}`;
    const name = lineText(m.name, "이름", 40);
    if (name) e[`${k}.name`] = name;
    else if (/[#@]/.test(m.name)) e[`${k}.name`] = "이름에 # 또는 @는 쓸 수 없어요";
    else if (/(^|\s)&\S/.test(m.name)) e[`${k}.name`] = "이름에 &로 시작하는 단어는 쓸 수 없어요";

    if (m.birth) {
      if (!isDate(m.birth)) e[`${k}.birth`] = "날짜 형식이 올바르지 않아요";
      else if (m.birth > today) e[`${k}.birth`] = "오늘 이후 날짜는 쓸 수 없어요";
      else if (m.birth < "1900-01-01") e[`${k}.birth`] = "1900년 이후로 입력해 주세요";
    }
    if (!isPickableColor(m.color)) e[`${k}.color`] = "색을 골라 주세요";

    const id = m.id.trim();
    if (!id) e[`${k}.id`] = "id를 입력해 주세요";
    else if (id.length > 32) e[`${k}.id`] = "32자 이하로 입력해 주세요";
    else if (!/^[A-Za-z0-9_-]+$/.test(id)) e[`${k}.id`] = "영문·숫자·-·_만 쓸 수 있어요";
    else if (id.toLowerCase() === "family") e[`${k}.id`] = "family는 '가족 전체'가 쓰는 id예요";
    else if (seen.has(id.toLowerCase())) e[`${k}.id`] = "다른 구성원과 같은 id예요";
    if (id) seen.set(id.toLowerCase(), seen.get(id.toLowerCase()) ?? m.key);
  }
  if (d.members.length > SETUP_MAX_MEMBERS) e.members = `구성원은 ${SETUP_MAX_MEMBERS}명까지예요`;
  else if (!d.members.some((m) => m.role === "guardian")) e.members = "보호자가 한 명 이상 있어야 해요 (슬랙에서 일정을 쓸 수 있는 사람이에요)";
  return e;
}

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function validMonthDay(month: string, day: string): boolean {
  const m = int(month);
  const dd = int(day);
  return m !== undefined && dd !== undefined && m >= 1 && m <= 12 && dd >= 1 && dd <= (DAYS[m - 1] ?? 0);
}

export function validateAnniversaries(d: Draft): Errors {
  const e: Errors = {};
  const ids = new Set(d.members.map((m) => m.id.trim()));
  for (const a of d.anniversaries) {
    const k = `anniv.${a.key}`;
    const t = lineText(a.title, "제목", 80);
    if (t) e[`${k}.title`] = t;
    else if (/[#@]/.test(a.title)) e[`${k}.title`] = "제목에 # 또는 @는 쓸 수 없어요";
    else if (/(^|\s)&\S/.test(a.title)) e[`${k}.title`] = "제목에 &로 시작하는 단어는 쓸 수 없어요";
    if (!validMonthDay(a.month, a.day)) e[`${k}.date`] = "월·일을 확인해 주세요 (없는 날짜예요)";
    if (a.member !== "family" && !ids.has(a.member)) e[`${k}.member`] = "등록된 구성원이 아니에요";
  }
  return e;
}

export function validateCalendar(d: Draft): Errors {
  const v = d.calendarId.trim();
  if (!v) return {}; // 선택 항목
  if (v.length > 254 || !CALENDAR_ID_RE.test(v)) return { calendarId: "abc123@group.calendar.google.com 같은 메일 주소 모양이어야 해요" };
  return {};
}

/** 단계 번호(1~6) -> 오류. 3(슬랙)·6(확인)은 입력이 없다. 6은 전체를 다시 본다. */
export function validateStep(d: Draft, step: number, now: Date = new Date()): Errors {
  switch (step) {
    case 1:
      return validateHome(d);
    case 2:
      return validateMembers(d, now);
    case 4:
      return validateAnniversaries(d);
    case 5:
      return validateCalendar(d);
    case 6:
      return { ...validateHome(d), ...validateMembers(d, now), ...validateAnniversaries(d), ...validateCalendar(d) };
    default:
      return {};
  }
}

/** 오류 필드가 속한 단계 */
export function stepOfField(field: string): number {
  if (field.startsWith("member")) return 2;
  if (field.startsWith("anniv")) return 4;
  if (field === "calendarId") return 5;
  if (field === "form" || field === "overwrite") return 6;
  return 1;
}

export const firstErrorStep = (errors: Errors): number | undefined => {
  const steps = Object.keys(errors).map(stepOfField);
  return steps.length ? Math.min(...steps) : undefined;
};

export const memberLabel = (m: MemberDraft, i: number) => m.name.trim() || `구성원 ${i + 1}`;
export const anniversaryKey = (a: AnnivDraft) => a.key;
