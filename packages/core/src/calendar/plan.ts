// 위키 일정 목록과 매핑을 비교해 구글에서 할 일(추가·수정·삭제)을 계산한다. 순수 함수.
import { addDays } from "../date";
import type { Event } from "../types";
import type { CalendarMapping } from "./mapping";

export interface PlanInput {
  events: readonly Event[];
  mapping: CalendarMapping;
  /** 이벤트 -> (구글 이벤트 id, 본문 해시) */
  describe: (e: Event) => { googleId: string; hash: string };
  /** 오늘(YYYY-MM-DD) */
  today: string;
  /** 오늘보다 이만큼 전 일정부터 새로 올린다(처음 켤 때 옛 일정이 쏟아지지 않게). 기본 30일. 이미 복사한 일정은 날짜와 상관없이 계속 따라간다 */
  lookbackDays?: number;
  /** 한 번에 하는 일의 상한. 넘는 것은 다음 실행으로. 기본 40 */
  maxOps?: number;
  /**
   * 위키 일정 목록에는 없지만 위키 events 원문에는 아직 `#evt-…`로 남아 있는 id(형식이 깨져 읽히지 않는 줄 등).
   * 지워진 것이 아니므로 이 건들만 삭제하지 않는다.
   */
  stillMentioned?: ReadonlySet<string>;
  /** 지난 바퀴에 영구 실패한 일정(뒤로 미뤄 다른 일정이 막히지 않게) */
  deprioritize?: ReadonlySet<string>;
  /** true면 대량 삭제 보류를 건너뛴다(같은 삭제가 오래 이어져 사람이 지운 것으로 확인된 경우) */
  forceRemovals?: boolean;
}

export interface PlannedUpsert {
  event: Event;
  googleId: string;
  hash: string;
  kind: "add" | "update";
}
export interface PlannedRemove {
  wikiId: string;
  googleId: string;
}

export interface CalendarPlan {
  upserts: PlannedUpsert[];
  removes: PlannedRemove[];
  /** 내용이 같아 건너뛴 수 */
  unchanged: number;
  /** 상한 때문에 다음 실행으로 미룬 수 */
  deferred: number;
  /** 대량 삭제가 의심돼 이번에는 삭제하지 않은 수(위키 읽기가 일부 빠졌을 가능성) */
  heldRemovals: number;
  /** 그 보류된 위키 일정 id들(같은 집합이 오래 이어지는지 보려고) */
  heldIds: string[];
  /** 원문에 아직 남아 있어 삭제하지 않은 수 */
  mentionedHeld: number;
}

export const DEFAULT_LOOKBACK_DAYS = 30;
export const DEFAULT_MAX_OPS = 40;
/** 삭제가 이 수 이상이고 복사해 둔 것의 절반을 넘으면 읽기 이상으로 보고 보류한다 */
export const MASS_REMOVE_MIN = 5;

export function planCalendarSync(input: PlanInput): CalendarPlan {
  const { events, mapping, today } = input;
  const since = addDays(today, -(input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS));
  const maxOps = input.maxOps ?? DEFAULT_MAX_OPS;

  const wikiIds = new Set(events.map((e) => e.id));
  let removes: PlannedRemove[] = Object.entries(mapping.entries)
    .filter(([id]) => !wikiIds.has(id))
    .map(([wikiId, v]) => ({ wikiId, googleId: v.googleId }))
    .sort((a, b) => a.wikiId.localeCompare(b.wikiId));

  const before = removes.length;
  removes = removes.filter((r) => !input.stillMentioned?.has(r.wikiId));
  const mentionedHeld = before - removes.length;

  let heldRemovals = 0;
  let heldIds: string[] = [];
  const mapped = Object.keys(mapping.entries).length;
  if (!input.forceRemovals && removes.length >= MASS_REMOVE_MIN && removes.length * 2 > mapped) {
    heldRemovals = removes.length;
    heldIds = removes.map((r) => r.wikiId);
    removes = [];
  }

  let unchanged = 0;
  const upserts: PlannedUpsert[] = [];
  for (const event of events) {
    const prev = mapping.entries[event.id];
    if (!prev && event.date < since) continue; // 새로 올리는 옛 일정은 건너뜀
    const d = input.describe(event);
    if (prev && prev.hash === d.hash && prev.googleId === d.googleId) {
      unchanged++;
      continue;
    }
    upserts.push({ event, googleId: d.googleId, hash: d.hash, kind: prev ? "update" : "add" });
  }
  const late = (id: string) => (input.deprioritize?.has(id) ? 1 : 0);
  upserts.sort((a, b) => late(a.event.id) - late(b.event.id) || a.event.date.localeCompare(b.event.date) || a.event.id.localeCompare(b.event.id));

  const total = removes.length + upserts.length;
  const keepRemoves = removes.slice(0, maxOps);
  const keepUpserts = upserts.slice(0, Math.max(0, maxOps - keepRemoves.length));
  return { upserts: keepUpserts, removes: keepRemoves, unchanged, deferred: total - keepRemoves.length - keepUpserts.length, heldRemovals, heldIds, mentionedHeld };
}
