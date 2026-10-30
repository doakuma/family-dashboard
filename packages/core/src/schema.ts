// 외부 입력(LLM 응답·세팅 폼 등)과 위키 파일 내용을 도메인 타입으로 받기 전에 검증하는 스키마.
// 읽기(파서)와 쓰기(applyChange·format*File)가 같은 스키마를 쓴다.
import { z } from "zod";
import type { Anniversary, Change, DashboardState, Event, FamilyConfig, Member, Task, WeatherDay } from "./types";

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
// 제목: 줄 끝 토큰(`#id`, `@멤버`)과 헷갈리는 # · @ 금지
const title = plain(80).refine((s) => !/[#@]/.test(s), "제목에 #, @ 금지");

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

// ---------- /api/state 응답 ----------

const eventSchema = z.object({
  id: eventId,
  date,
  start: time.optional(),
  end: time.optional(),
  allDay: z.boolean(),
  title: z.string(),
  members: z.array(z.string()),
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

export const dashboardStateSchema = z.object({
  config: familyConfigSchema.optional(),
  members: z.array(memberSchema.extend({ id: memberIdSchema })), // 응답에는 내장 'family'도 들어 있다
  events: z.array(eventSchema),
  tasks: z.array(taskSchema),
  anniversaries: z.array(anniversarySchema),
  weather: z.array(weatherDaySchema),
  updatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ISO 8601"),
}) satisfies z.ZodType<DashboardState>;

/** /api/state 응답: 상태 + 서버가 판단한 세팅 필요 여부 */
export const apiStateSchema = dashboardStateSchema.extend({ needsSetup: z.boolean() });
export type ApiState = z.infer<typeof apiStateSchema>;
