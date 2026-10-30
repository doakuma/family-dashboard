// 외부 입력(LLM 응답·세팅 폼 등)과 위키 파일 내용을 도메인 타입으로 받기 전에 검증하는 스키마.
// 읽기(파서)와 쓰기(applyChange·format*File)가 같은 스키마를 쓴다.
import { z } from "zod";
import { KMA_NX_RANGE, KMA_NY_RANGE, KMA_REG_ID_RE } from "./regions";
import { FAMILY_ID, type Anniversary, type Change, type DashboardState, type Event, type FamilyConfig, type Member, type SetupInput, type Task, type WeatherDay } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = z.string().regex(DATE_RE, "YYYY-MM-DD").refine(isRealDate, "없는 날짜");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

function isRealDate(s: string) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === m && t.getUTCDate() === d;
}

/** 줄바꿈·제어문자(U+2028/2029 포함). 위키는 줄 단위 형식이라 값에 들어가면 형식이 깨진다. */
export const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u;
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), "줄바꿈·제어문자 금지");

/** 구성원 id 규칙 (위키 `@id` 토큰과 같다) */
export const memberIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
/** 일정 공유 그룹 id (위키 `&id` 토큰). 구성원 id와 같은 형식(스펙 rev 54). 비교는 sameShareGroup으로(대소문자 무시). */
export const shareGroupIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, "영문·숫자·_·-");
export const sameShareGroup = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
// 제목: 줄 끝 토큰(`#id`, `@멤버`, `&그룹`)과 헷갈리는 # · @ 금지, 단어 앞 &(`&cousins`)도 금지 (`R&D`, `A & B`는 허용)
const title = plain(80)
  .refine((s) => !/[#@]/.test(s), "제목에 #, @ 금지")
  .refine((s) => !/(^|\s)&\S/.test(s), "제목에 &토큰 금지");

const eventBase = z.object({
  date,
  start: time.optional(),
  end: time.optional(),
  allDay: z.boolean(),
  title,
  members: z.array(memberIdSchema).min(1),
});

const endAfterStart = (e: { start?: string; end?: string }) => !e.start || !e.end || e.end > e.start;

const eventAdd = eventBase
  .refine((e) => e.allDay || !!e.start, { message: "allDay가 아니면 start 필요", path: ["start"] })
  .refine(endAfterStart, { message: "end는 start보다 늦어야 해요", path: ["end"] });

const eventId = z.string().regex(/^evt-[A-Za-z0-9]+$/);
const taskId = z.string().regex(/^task-[A-Za-z0-9]+$/);

export const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event.add"), payload: eventAdd }),
  z.object({
    kind: z.literal("event.update"),
    payload: eventBase.partial().extend({ id: eventId }).refine(endAfterStart, { message: "end는 start보다 늦어야 해요", path: ["end"] }),
  }),
  z.object({ kind: z.literal("event.remove"), payload: z.object({ id: eventId }) }),
  z.object({
    kind: z.literal("task.add"),
    payload: z.object({ list: z.enum(["shopping", "todo"]), title, member: memberIdSchema.optional() }),
  }),
  z.object({ kind: z.literal("task.done"), payload: z.object({ id: taskId }) }),
  z.object({
    kind: z.literal("anniversary.add"),
    payload: z.object({ monthDay, title, member: memberIdSchema.optional() }),
  }),
]) satisfies z.ZodType<Change>;

// ---------- 구성원 · config (읽기·쓰기 공용) ----------

export const memberSchema = z.object({
  id: memberIdSchema.refine((id) => id !== "family", "family는 예약 id"),
  name: plain(40),
  role: z.enum(["guardian", "child"]),
  birth: date.optional(),
  color: z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-z][a-z0-9_-]*)$/, "색 이름 또는 #hex"),
  slackId: z.string().regex(/^[A-Za-z0-9]+$/).optional(),
}) satisfies z.ZodType<Member>;

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "알 수 없는 시간대");
const token = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const familyConfigSchema = z.object({
  familyName: plain(40),
  timezone,
  region: plain(80).optional(),
  kmaNx: z.number().int().optional(),
  kmaNy: z.number().int().optional(),
  kmaMidLandRegId: token.optional(),
  kmaMidTaRegId: token.optional(),
  familyColor: z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-z][a-z0-9_-]*)$/),
  calendarId: z.string().regex(/^\S+$/).refine((s) => !CONTROL_CHARS.test(s)).optional(),
  setupCompletedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/)
    .refine((s) => !Number.isNaN(Date.parse(s)), "날짜 형식 오류")
    .optional(),
}) satisfies z.ZodType<FamilyConfig>;

// ---------- /setup 첫 세팅 (WikiRepository.applySetup 입력) ----------

/** 구글 캘린더 ID 형식: 메일 주소 꼴(`abc@group.calendar.google.com`, `me@gmail.com`). 연결 확인이 아니라 형식만 본다. */
export const CALENDAR_ID_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const SETUP_MAX_MEMBERS = 12;
export const SETUP_MAX_ANNIVERSARIES = 60;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 매년 반복이라 2월 29일도 허용
/** 실제로 있는 MM-DD (04-31 같은 날은 거부) */
export const realMonthDay = monthDay.refine((s) => Number(s.slice(3)) <= (DAYS_IN_MONTH[Number(s.slice(0, 2)) - 1] ?? 0), "없는 날짜");

const kmaRegId = z.string().regex(KMA_REG_ID_RE, "예: 11B00000");

/** 프론트매터 값은 따옴표로 감싸면 읽을 때 달라져서 쓰기가 거부된다(stringifyFrontmatter). 폼에서 미리 걸러낸다. */
const notQuoted = (s: string) => !/^(["']).*\1$/.test(s);
const QUOTED = "따옴표로 감싼 값은 쓸 수 없어요";

const setupConfigSchema = familyConfigSchema.omit({ setupCompletedAt: true }).extend({
  familyName: plain(40).refine(notQuoted, QUOTED),
  region: plain(80).refine(notQuoted, QUOTED).optional(),
  kmaNx: z.number().int().min(KMA_NX_RANGE[0]).max(KMA_NX_RANGE[1]).optional(),
  kmaNy: z.number().int().min(KMA_NY_RANGE[0]).max(KMA_NY_RANGE[1]).optional(),
  kmaMidLandRegId: kmaRegId.optional(),
  kmaMidTaRegId: kmaRegId.optional(),
  calendarId: z.string().max(254).regex(CALENDAR_ID_RE, "메일 주소 모양이어야 해요").optional(),
});

const setupAnniversarySchema = z.object({ monthDay: realMonthDay, title, member: memberIdSchema.optional() });

/**
 * 첫 세팅 전체 검증. 개별 스키마(memberSchema·familyConfigSchema)에 더해 묶음 규칙을 본다:
 * 구성원 id는 대소문자 구분 없이 유일(Windows 파일 이름 충돌 방지), 보호자 1명 이상, 기념일의 구성원은 등록된 id 또는 family,
 * 격자·지역코드는 네 값이 함께 있거나 함께 없어야 한다.
 */
export const setupSchema = z
  .object({
    config: setupConfigSchema,
    members: z.array(memberSchema.extend({ name: plain(40).refine(notQuoted, QUOTED) })).min(1, "구성원을 한 명 이상 넣어 주세요").max(SETUP_MAX_MEMBERS, `구성원은 ${SETUP_MAX_MEMBERS}명까지예요`),
    anniversaries: z.array(setupAnniversarySchema).max(SETUP_MAX_ANNIVERSARIES),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.members.forEach((m, i) => {
      const k = m.id.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["members", i, "id"], message: "이미 쓰는 id예요" });
      seen.add(k);
    });
    if (!v.members.some((m) => m.role === "guardian")) ctx.addIssue({ code: "custom", path: ["members"], message: "보호자가 한 명 이상 있어야 해요" });
    v.anniversaries.forEach((a, i) => {
      if (a.member && a.member !== FAMILY_ID && !seen.has(a.member.toLowerCase())) ctx.addIssue({ code: "custom", path: ["anniversaries", i, "member"], message: "등록되지 않은 구성원이에요" });
    });
    const c = v.config;
    const grid = [c.kmaNx, c.kmaNy, c.kmaMidLandRegId, c.kmaMidTaRegId];
    if (grid.some((x) => x !== undefined) && grid.some((x) => x === undefined)) ctx.addIssue({ code: "custom", path: ["config", "kmaNx"], message: "격자(nx, ny)와 지역 코드 2개를 함께 넣어 주세요" });
  }) satisfies z.ZodType<SetupInput>;

// ---------- /api/state 응답 ----------

const eventSchema = z.object({
  id: eventId,
  date,
  start: time.optional(),
  end: time.optional(),
  allDay: z.boolean(),
  title: z.string(),
  members: z.array(z.string()),
  share: shareGroupIdSchema.optional(),
  done: z.boolean(),
}) satisfies z.ZodType<Event>;

const taskSchema = z.object({
  id: taskId,
  list: z.enum(["shopping", "todo"]),
  title: z.string(),
  member: z.string().optional(),
  done: z.boolean(),
}) satisfies z.ZodType<Task>;

const anniversarySchema = z.object({ monthDay, title: z.string(), member: z.string().optional() }) satisfies z.ZodType<Anniversary>;

const weatherDaySchema = z.object({
  date,
  icon: z.enum(["sunny", "partly", "cloudy", "rain", "snow", "shower"]),
  max: z.number(),
  min: z.number(),
  pop: z.number().optional(),
}) satisfies z.ZodType<WeatherDay>;

const publicMemberSchema = z.object({ id: memberIdSchema, name: z.string(), color: z.string() });

const publicAnniversarySchema = z.object({
  monthDay,
  title: z.string(),
  member: z.string().optional(),
  /** 생일이면 다음 생일 날짜와 그날 되는 나이. 화면이 birth 원문 없이 "n살"을 보여 주기 위한 값 */
  turns: z.object({ date, age: z.number().int() }).optional(),
});

/**
 * /api/state 응답 = 태블릿 화면이 실제로 쓰는 필드만. 내부 상태(DashboardState)와 따로 둔다.
 * 주소(region)·slackId·calendarId·역할·생일 원문은 내보내지 않는다 (toPublicState가 허용 목록으로 골라 담는다).
 */
export const apiStateSchema = z.object({
  familyName: z.string().optional(),
  members: z.array(publicMemberSchema), // 내장 'family' 포함
  events: z.array(eventSchema),
  tasks: z.array(taskSchema),
  anniversaries: z.array(publicAnniversarySchema),
  weather: z.array(weatherDaySchema),
  updatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ISO 8601"),
  /** 서버가 판단한 세팅 필요 여부 */
  needsSetup: z.boolean(),
});
export type ApiState = z.infer<typeof apiStateSchema>;
export type PublicMember = ApiState["members"][number];
export type PublicAnniversary = ApiState["anniversaries"][number];

// 내부 상태 검증(테스트·어댑터용)
export const dashboardStateSchema = z.object({
  config: familyConfigSchema.optional(),
  members: z.array(memberSchema.extend({ id: memberIdSchema })),
  events: z.array(eventSchema),
  tasks: z.array(taskSchema),
  anniversaries: z.array(anniversarySchema),
  weather: z.array(weatherDaySchema),
  updatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ISO 8601"),
}) satisfies z.ZodType<DashboardState>;
