// 위키 Event -> 구글 캘린더 이벤트 본문. 순수 함수(브라우저 안전). 구글 쪽 id는 어댑터가 정한다(결정 0012).
import { addDays } from "../date";
import type { Event } from "../types";
import { FAMILY_ID } from "../types";

/** 끝 시각이 없는 시간 일정의 기본 길이(분) */
export const DEFAULT_EVENT_MINUTES = 60;

export interface EventBodyContext {
  /** config.md의 timezone (기본 Asia/Seoul) */
  timezone: string;
  /** 구성원 id -> 이름(설명에 "담당"으로 적음). 모르는 id는 id 그대로 */
  names: Readonly<Record<string, string>>;
}

export type GoogleEventTime = { date: string } | { dateTime: string; timeZone: string };

export interface GoogleEventBody {
  summary: string;
  description: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  /** 취소된(지워진) 같은 id를 다시 살릴 때 필요 */
  status: "confirmed";
  extendedProperties: { private: { hsh: "1"; hshId: string } };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** 시간 일정의 끝: end가 start보다 늦으면 그대로, 아니면 start + 기본 길이(자정을 넘으면 다음 날) */
function endOf(e: Event & { start: string }): { date: string; time: string } {
  if (e.end && toMin(e.end) > toMin(e.start)) return { date: e.date, time: e.end };
  const m = toMin(e.start) + DEFAULT_EVENT_MINUTES;
  return m >= 1440 ? { date: addDays(e.date, 1), time: hhmm(m - 1440) } : { date: e.date, time: hhmm(m) };
}

export function describeEvent(e: Event, names: EventBodyContext["names"]): string {
  const who = e.members.map((id) => (id === FAMILY_ID ? "가족" : (names[id] ?? id)));
  return [
    who.length ? `담당: ${who.join(", ")}` : undefined,
    e.done ? "완료 처리된 일정" : undefined,
    `위키 일정 id: ${e.id}`,
    "HomeSweetHome 위키에서 복사한 일정이에요. 여기서 고쳐도 위키에는 반영되지 않고, 다음 동기화 때 위키 내용으로 덮여요.",
  ]
    .filter((l): l is string => !!l)
    .join("\n");
}

export function toGoogleEvent(e: Event, ctx: EventBodyContext): GoogleEventBody {
  const common = {
    summary: e.title,
    description: describeEvent(e, ctx.names),
    status: "confirmed" as const,
    extendedProperties: { private: { hsh: "1" as const, hshId: e.id } },
  };
  if (e.allDay || !e.start) {
    // 종일: 끝 날짜는 exclusive(하루짜리면 다음 날)
    return { ...common, start: { date: e.date }, end: { date: addDays(e.date, 1) } };
  }
  const end = endOf({ ...e, start: e.start });
  return {
    ...common,
    start: { dateTime: `${e.date}T${e.start}:00`, timeZone: ctx.timezone },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: ctx.timezone },
  };
}

/** 키 순서와 상관없이 같은 값이면 같은 문자열(내용 해시용) */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
