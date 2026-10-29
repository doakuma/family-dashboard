// 외부 입력(LLM 응답 등)을 Change로 받기 전에 검증하는 스키마.
import { z } from "zod";
import type { Change } from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const memberId = z.string().regex(/^[A-Za-z0-9_-]+$/);
const title = z.string().trim().min(1).max(80).refine((s) => !/[#@\n]/.test(s), "제목에 #, @, 줄바꿈 금지");

const eventBase = z.object({
  date,
  start: time.optional(),
  end: time.optional(),
  allDay: z.boolean(),
  title,
  members: z.array(memberId).min(1),
});

export const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event.add"), payload: eventBase }),
  z.object({ kind: z.literal("event.update"), payload: eventBase.partial().extend({ id: z.string().regex(/^evt-\w+$/) }) }),
  z.object({ kind: z.literal("event.remove"), payload: z.object({ id: z.string().regex(/^evt-\w+$/) }) }),
  z.object({
    kind: z.literal("task.add"),
    payload: z.object({ list: z.enum(["shopping", "todo"]), title, member: memberId.optional() }),
  }),
  z.object({ kind: z.literal("task.done"), payload: z.object({ id: z.string().regex(/^task-\w+$/) }) }),
  z.object({
    kind: z.literal("anniversary.add"),
    payload: z.object({ monthDay: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/), title, member: memberId.optional() }),
  }),
]) satisfies z.ZodType<Change>;
