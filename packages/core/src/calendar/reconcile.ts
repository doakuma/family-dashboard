// 위키 -> 구글 캘린더 단방향 복사의 한 바퀴(결정 0012). 위키가 원본이라 항상 "지금 위키 일정 vs 지금까지 복사한 기록"을 비교해 맞춘다.
// 그래서 슬랙 apply 뒤에 불러도, 몇 분마다 불러도, 위키를 직접 고치거나 pull로 바뀐 일정도 같은 코드로 따라간다.
// 실패해도 던지지 않고 결과로 알린다(위키 쓰기와 대화 흐름을 절대 실패시키지 않는다).
import { todayIn } from "../date";
import type { CalendarSync } from "../ports";
import { CALENDAR_ID_RE } from "../schema";
import type { Event, FamilyId, WikiState } from "../types";
import { ABORT_KINDS, CalendarSyncError, PERMANENT_ITEM_KINDS, type CalendarErrorKind } from "./errors";
import { toGoogleEvent, stableStringify, type EventBodyContext } from "./google-event";
import { emptyMapping, type CalendarMapping, type CalendarMappingStore } from "./mapping";
import { planCalendarSync } from "./plan";

/** 어댑터와 reconciler가 함께 보는 값. reconciler가 매 실행 처음에 위키에서 읽어 채운다(어댑터는 CalendarSync 포트 모양이라 일정만 받기 때문) */
export interface CalendarRuntime {
  calendarId?: string;
  /** 위키 일정 id -> 구글 id 세대(없으면 0). reconciler가 복사 기록에서 채운다 */
  generations?: Record<string, number>;
  context: EventBodyContext;
}

export interface ReconcilerDeps {
  familyId: FamilyId;
  readState: (familyId: FamilyId) => Promise<Pick<WikiState, "config" | "events" | "members" | "warnings">>;
  /** checkAccess가 있으면 할 일이 있는 바퀴 처음에 한 번 부른다(캘린더가 공유 안 됐거나 풀렸는지. 404를 "이미 지워짐"으로 오해하지 않게) */
  sync: CalendarSync & { checkAccess?(): Promise<void> };
  store: CalendarMappingStore;
  runtime: CalendarRuntime;
  /** config.md에 calendarId가 없을 때 쓸 값(GOOGLE_CALENDAR_ID) */
  fallbackCalendarId?: string;
  /** 문자열 -> 해시(sha256 hex). 브라우저 안전을 위해 주입 */
  hash: (s: string) => string;
  /** (familyId, 위키 id, 세대) -> 구글 이벤트 id */
  googleId: (familyId: FamilyId, wikiId: string, gen: number) => string;
  /** 위키 events 원문에 이 일정 id(`#evt-…`)가 아직 남아 있는지. 형식이 깨져 읽히지 않는 줄을 "지워진 일정"으로 오해하지 않게 */
  mentionsEventId?: (wikiId: string) => boolean | Promise<boolean>;
  /** 같은 대량 삭제가 이만큼(ms) 이어지면 사람이 지운 것으로 보고 진행한다. 기본 15분 */
  holdReleaseMs?: number;
  /** 도는 중에 온 요청이 중단된 바퀴 때문에 못 처리됐을 때 다시 시도할 간격(ms). 기본 60초 */
  retryDelayMs?: number;
  now?: () => Date;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  lookbackDays?: number;
  maxOps?: number;
}

export interface ReconcileResult {
  /** ok = 끝까지 돌았음(일부 실패 가능), disabled = 캘린더 id 없음, aborted = 인증·권한·한도 문제로 중간에 멈춤, read_failed = 위키를 못 읽음 */
  status: "ok" | "disabled" | "aborted" | "read_failed";
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  failed: number;
  deferred: number;
  heldRemovals: number;
  /** 실패 종류별 수(로그용) */
  errors: Partial<Record<CalendarErrorKind | "unknown", number>>;
}

const blankResult = (status: ReconcileResult["status"]): ReconcileResult => ({ status, added: 0, updated: 0, removed: 0, unchanged: 0, failed: 0, deferred: 0, heldRemovals: 0, errors: {} });

const KIND_HINT: Partial<Record<CalendarErrorKind, string>> = {
  auth: "서비스 계정 키를 확인해 주세요",
  forbidden: "캘린더를 서비스 계정 이메일에 '일정 변경' 권한으로 공유했는지 확인해 주세요",
  config: "캘린더 설정을 확인해 주세요",
  rate_limit: "구글 요청 한도에 걸렸어요. 잠시 뒤 다시 시도해요",
};

/** 이 수만큼 연달아 실패하면 그 실행은 멈춘다 */
export const MAX_CONSECUTIVE_FAILURES = 3;

export class CalendarReconciler {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private readonly warn: (m: string) => void;
  private current: Promise<ReconcileResult> | undefined;
  private again = false;
  private warnedDisabled = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** 지난 바퀴에 영구 실패한 일정(메모리): 다음 바퀴에서 뒤로 미룬다 */
  private readonly failedIds = new Set<string>();
  private held: { key: string; since: number } | undefined;

  constructor(private readonly deps: ReconcilerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((m) => console.log(`[calendar] ${m}`));
    this.warn = deps.warn ?? ((m) => console.warn(`[calendar] ${m}`));
  }

  /**
   * 한 바퀴 돈다. 이미 돌고 있으면 새로 시작하지 않고 그 실행에 합친다(끝난 뒤 한 번 더 돌아 그 사이의 변경을 따라간다).
   * 던지지 않는다.
   */
  run(): Promise<ReconcileResult> {
    if (this.current) {
      this.again = true;
      return this.current;
    }
    this.current = this.loop();
    return this.current;
  }

  /** 예약된 재시도를 취소한다(종료·시험용) */
  dispose(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private async loop(): Promise<ReconcileResult> {
    let result = await this.once();
    // 도는 동안 또 요청이 왔으면 한 번 더(최대 2번). 일부 실패한 바퀴여도 요청을 버리지 않는다
    for (let i = 0; this.again && i < 2 && result.status === "ok"; i++) {
      this.again = false;
      result = await this.once();
    }
    // 여기부터 끝까지 await가 없다: 검사와 current 해제 사이에 들어온 요청이 버려지지 않게
    const leftover = this.again;
    this.again = false;
    this.current = undefined;
    // 중단된 바퀴(인증·한도 등) 때문에 못 처리한 요청은 잠시 뒤 한 번 다시
    if (leftover && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        void this.run();
      }, this.deps.retryDelayMs ?? 60_000);
      this.retryTimer.unref?.();
    }
    return result;
  }

  private async once(): Promise<ReconcileResult> {
    try {
      return await this.runOnce();
    } catch (e) {
      // 여기까지 새는 것은 우리 쪽 오류(저장소 읽기 등). 내용은 로그에 싣지 않는다(키·경로가 섞일 수 있음)
      this.warn(`동기화 중 예상 못한 오류(${e instanceof Error ? e.name : typeof e}). 다음에 다시 해요`);
      return { ...blankResult("read_failed") };
    }
  }

  private async runOnce(): Promise<ReconcileResult> {
    const { deps } = this;
    let state: Awaited<ReturnType<ReconcilerDeps["readState"]>>;
    try {
      state = await deps.readState(deps.familyId);
    } catch {
      this.warn("위키를 읽지 못해 이번 동기화는 건너뛰어요");
      return blankResult("read_failed");
    }

    // config.md를 못 읽었거나 calendarId 값이 깨졌으면 이번 바퀴는 건너뛴다: 환경 변수의 다른 캘린더로 잘못 올리지 않게
    const configWarned = state.warnings.some((w) => w.startsWith("config.md") && (!state.config || w.includes("calendarId")));
    if (configWarned) {
      this.warn("config.md를 제대로 읽지 못해(calendarId 확인 필요) 이번 동기화는 건너뛰어요");
      return blankResult("read_failed");
    }
    const calendarId = state.config?.calendarId ?? deps.fallbackCalendarId;
    if (calendarId && !CALENDAR_ID_RE.test(calendarId)) {
      this.warn("캘린더 id가 메일 주소 모양이 아니라 복사를 건너뛰어요(config.md calendarId 확인)");
      return blankResult("disabled");
    }
    if (!calendarId) {
      if (!this.warnedDisabled) {
        this.warnedDisabled = true;
        this.log("캘린더 id가 없어(config.md calendarId·GOOGLE_CALENDAR_ID) 복사를 건너뛰어요");
      }
      return blankResult("disabled");
    }
    this.warnedDisabled = false;

    const names: Record<string, string> = {};
    for (const m of state.members) names[m.id] = m.name;
    deps.runtime.calendarId = calendarId;
    deps.runtime.context = { timezone: state.config?.timezone ?? "Asia/Seoul", names };

    const fingerprint = deps.hash(`calendar:${calendarId}`).slice(0, 16);
    const read = await deps.store.read();
    if (read.broken) this.warn("복사 기록 파일이 깨져 있어 새로 시작해요(구글 쪽 일정은 같은 id로 덮어써서 중복되지 않아요)");
    let mapping: CalendarMapping = read.mapping ?? emptyMapping(fingerprint);
    if (mapping.calendar !== fingerprint) {
      this.log("캘린더가 바뀌어 복사 기록을 새로 시작해요(이전 캘린더의 복사본은 그대로 남아요)");
      mapping = emptyMapping(fingerprint);
    }
    const entries = { ...mapping.entries };
    const gens: Record<string, number> = {};
    for (const [id, v] of Object.entries(entries)) if (v.gen) gens[id] = v.gen;
    deps.runtime.generations = gens;

    // 위키 일정 목록에서 빠졌지만 events 원문에는 아직 남아 있는 id(깨진 줄)는 지워진 것이 아니다
    const wikiIds = new Set(state.events.map((e) => e.id));
    const stillMentioned = new Set<string>();
    if (deps.mentionsEventId) {
      for (const id of Object.keys(entries)) if (!wikiIds.has(id) && (await deps.mentionsEventId(id))) stillMentioned.add(id);
    }

    const describe = (e: Event) => ({
      googleId: deps.googleId(deps.familyId, e.id, entries[e.id]?.gen ?? 0),
      hash: deps.hash(stableStringify(toGoogleEvent(e, deps.runtime.context))),
    });
    const planWith = (forceRemovals: boolean) =>
      planCalendarSync({ events: state.events, mapping: { ...mapping, entries }, describe, today: todayIn(this.now()), lookbackDays: deps.lookbackDays, maxOps: deps.maxOps, stillMentioned, deprioritize: this.failedIds, forceRemovals });
    let plan = planWith(false);

    if (plan.heldIds.length) {
      // 같은 삭제 집합이 오래 이어지면(사람이 정말 지운 것) 진행한다. 아니면 보류하고 알린다
      const key = plan.heldIds.join(",");
      const nowMs = this.now().getTime();
      if (this.held?.key !== key) this.held = { key, since: nowMs };
      if (nowMs - this.held.since >= (deps.holdReleaseMs ?? 15 * 60_000)) {
        this.warn(`위키에서 사라진 일정 ${plan.heldIds.length}건이 오래 그대로라 사람이 지운 것으로 보고 구글에서도 지워요`);
        this.held = undefined;
        plan = planWith(true);
      } else {
        this.warn(`위키에서 사라진 일정이 ${plan.heldIds.length}건으로 많아 삭제를 보류했어요(읽기 문제일 수 있음. 같은 상태가 계속되면 자동으로 진행해요)`);
      }
    } else {
      this.held = undefined;
    }
    if (plan.mentionedHeld) this.warn(`위키 events 파일에 형식이 깨진 일정 줄이 ${plan.mentionedHeld}건 남아 있어 그 일정은 지우지 않았어요(위키를 확인해 주세요)`);

    const result = blankResult("ok");
    result.unchanged = plan.unchanged;
    result.deferred = plan.deferred;
    result.heldRemovals = plan.heldRemovals;
    if (!plan.removes.length && !plan.upserts.length) return result; // 할 일이 없으면 구글을 부르지 않는다

    const save = async () => {
      try {
        await deps.store.write({ ...mapping, entries });
      } catch {
        this.warn("복사 기록을 저장하지 못했어요(다음 동기화에서 같은 일을 다시 해도 중복되지 않아요)");
      }
    };
    // 연달아 실패하면 구글 쪽 문제로 보고 멈춘다(느린 재시도를 건마다 반복하지 않게). 그 일정 하나만의 영구 오류는 세지 않는다
    let streak = 0;
    const fail = (e: unknown, wikiId?: string): boolean => {
      result.failed++;
      const kind = e instanceof CalendarSyncError ? e.kind : "unknown";
      result.errors[kind] = (result.errors[kind] ?? 0) + 1;
      const permanent = e instanceof CalendarSyncError && PERMANENT_ITEM_KINDS.includes(e.kind);
      if (permanent && wikiId) this.failedIds.add(wikiId);
      if (!permanent) streak++;
      return streak >= MAX_CONSECUTIVE_FAILURES || (e instanceof CalendarSyncError && ABORT_KINDS.includes(e.kind));
    };
    const summarize = () => {
      if (result.failed) {
        const kinds = Object.entries(result.errors).map(([k, n]) => `${k} ${n}`).join(", ");
        const hint = Object.keys(result.errors).map((k) => KIND_HINT[k as CalendarErrorKind]).find(Boolean);
        this.warn(`구글 캘린더 복사 ${result.failed}건 실패(${kinds}). 위키에는 저장돼 있고 다음 동기화 때 다시 해요${hint ? `. ${hint}` : ""}`);
      }
      const changed = result.added + result.updated + result.removed;
      if (changed) this.log(`구글 캘린더에 반영: 추가 ${result.added}, 수정 ${result.updated}, 삭제 ${result.removed}${result.deferred ? `, 다음으로 미룸 ${result.deferred}` : ""}`);
    };

    // 캘린더에 접근할 수 있는지 먼저 확인한다: 공유가 풀렸을 때 구글은 404를 주는데, 지우기에서는 404가 "이미 지워짐"이라 고아 복사본이 남는다
    if (deps.sync.checkAccess) {
      try {
        await deps.sync.checkAccess();
      } catch (e) {
        fail(e);
        result.status = "aborted";
        summarize();
        return result;
      }
    }

    let aborted = false;
    for (const r of plan.removes) {
      try {
        await deps.sync.remove(r.wikiId);
        streak = 0;
        delete entries[r.wikiId];
        delete gens[r.wikiId];
        this.failedIds.delete(r.wikiId);
        result.removed++;
        await save();
      } catch (e) {
        if (fail(e, r.wikiId)) {
          aborted = true;
          break;
        }
      }
    }
    if (!aborted) {
      for (const u of plan.upserts) {
        try {
          let googleId = u.googleId;
          try {
            await deps.sync.upsert(u.event);
          } catch (e) {
            // 지운 같은 id를 되살리지 못하는 경우: 세대를 올려 새 id로 만든다
            if (!(e instanceof CalendarSyncError) || e.kind !== "conflict") throw e;
            const gen = (entries[u.event.id]?.gen ?? 0) + 1;
            gens[u.event.id] = gen;
            googleId = deps.googleId(deps.familyId, u.event.id, gen);
            try {
              await deps.sync.upsert(u.event);
            } catch (e2) {
              if (gen - 1 > 0) gens[u.event.id] = gen - 1;
              else delete gens[u.event.id];
              throw e2;
            }
          }
          streak = 0;
          this.failedIds.delete(u.event.id);
          const gen = gens[u.event.id];
          entries[u.event.id] = { googleId, hash: u.hash, at: this.now().toISOString(), ...(gen ? { gen } : {}) };
          if (u.kind === "add") result.added++;
          else result.updated++;
          await save();
        } catch (e) {
          if (fail(e, u.event.id)) {
            aborted = true;
            break;
          }
        }
      }
    }
    if (aborted) result.status = "aborted";
    summarize();
    return result;
  }
}
