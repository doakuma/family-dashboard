// 위키 -> 구글 캘린더 단방향 복사의 한 바퀴(결정 0012). 위키가 원본이라 항상 "지금 위키 일정 vs 지금까지 복사한 기록"을 비교해 맞춘다.
// 그래서 슬랙 apply 뒤에 불러도, 몇 분마다 불러도, 위키를 직접 고치거나 pull로 바뀐 일정도 같은 코드로 따라간다.
// 실패해도 던지지 않고 결과로 알린다(위키 쓰기와 대화 흐름을 절대 실패시키지 않는다).
import { todayIn } from "../date";
import type { CalendarSync } from "../ports";
import type { Event, FamilyId, WikiState } from "../types";
import { ABORT_KINDS, CalendarSyncError, type CalendarErrorKind } from "./errors";
import { toGoogleEvent, stableStringify, type EventBodyContext } from "./google-event";
import { emptyMapping, type CalendarMapping, type CalendarMappingStore } from "./mapping";
import { planCalendarSync } from "./plan";

/** 어댑터와 reconciler가 함께 보는 값. reconciler가 매 실행 처음에 위키에서 읽어 채운다(어댑터는 CalendarSync 포트 모양이라 일정만 받기 때문) */
export interface CalendarRuntime {
  calendarId?: string;
  context: EventBodyContext;
}

export interface ReconcilerDeps {
  familyId: FamilyId;
  readState: (familyId: FamilyId) => Promise<Pick<WikiState, "config" | "events" | "members" | "warnings">>;
  sync: CalendarSync;
  store: CalendarMappingStore;
  runtime: CalendarRuntime;
  /** config.md에 calendarId가 없을 때 쓸 값(GOOGLE_CALENDAR_ID) */
  fallbackCalendarId?: string;
  /** 문자열 -> 해시(sha256 hex). 브라우저 안전을 위해 주입 */
  hash: (s: string) => string;
  /** (familyId, 위키 id) -> 구글 이벤트 id */
  googleId: (familyId: FamilyId, wikiId: string) => string;
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
    const p = this.loop().finally(() => {
      if (this.current === p) this.current = undefined;
    });
    this.current = p;
    return p;
  }

  private async loop(): Promise<ReconcileResult> {
    let result = await this.once();
    // 도는 동안 또 요청이 왔으면 한 번 더(최대 2번). 멈춘 실행(인증·한도)은 바로 다시 두드리지 않는다
    for (let i = 0; this.again && i < 2 && result.status === "ok" && result.failed === 0; i++) {
      this.again = false;
      result = await this.once();
    }
    this.again = false;
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

    const calendarId = state.config?.calendarId ?? deps.fallbackCalendarId;
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

    // 위키 읽기에 events 문제가 있으면(일부 줄을 건너뜀) 삭제는 하지 않는다: 안 보이는 일정을 지워진 것으로 오해하지 않게
    const eventsWarned = state.warnings.some((w) => w.startsWith("events/"));
    const describe = (e: Event) => ({
      googleId: deps.googleId(deps.familyId, e.id),
      hash: deps.hash(stableStringify(toGoogleEvent(e, deps.runtime.context))),
    });
    const plan = planCalendarSync({
      events: state.events,
      mapping,
      describe,
      today: todayIn(this.now()),
      lookbackDays: deps.lookbackDays,
      maxOps: deps.maxOps,
      allowRemovals: !eventsWarned,
    });

    const result = blankResult("ok");
    result.unchanged = plan.unchanged;
    result.deferred = plan.deferred;
    result.heldRemovals = plan.heldRemovals;
    if (plan.heldRemovals) this.warn(`위키에서 사라진 일정이 ${plan.heldRemovals}건으로 많거나 위키 읽기에 문제가 있어 삭제는 보류했어요(확인 필요)`);

    const entries = { ...mapping.entries };
    const save = async () => {
      try {
        await deps.store.write({ ...mapping, entries });
      } catch {
        this.warn("복사 기록을 저장하지 못했어요(다음 동기화에서 같은 일을 다시 해도 중복되지 않아요)");
      }
    };
    // 연달아 실패하면 구글 쪽 문제로 보고 멈춘다(느린 재시도를 건마다 반복하지 않게)
    let streak = 0;
    const fail = (e: unknown): boolean => {
      result.failed++;
      streak++;
      const kind = e instanceof CalendarSyncError ? e.kind : "unknown";
      result.errors[kind] = (result.errors[kind] ?? 0) + 1;
      return streak >= MAX_CONSECUTIVE_FAILURES || (e instanceof CalendarSyncError && ABORT_KINDS.includes(e.kind));
    };

    let aborted = false;
    for (const r of plan.removes) {
      try {
        await deps.sync.remove(r.wikiId);
        streak = 0;
        delete entries[r.wikiId];
        result.removed++;
        await save();
      } catch (e) {
        if (fail(e)) {
          aborted = true;
          break;
        }
      }
    }
    if (!aborted) {
      for (const u of plan.upserts) {
        try {
          await deps.sync.upsert(u.event);
          streak = 0;
          entries[u.event.id] = { googleId: u.googleId, hash: u.hash, at: this.now().toISOString() };
          if (u.kind === "add") result.added++;
          else result.updated++;
          await save();
        } catch (e) {
          if (fail(e)) {
            aborted = true;
            break;
          }
        }
      }
    }
    if (aborted) result.status = "aborted";

    const changed = result.added + result.updated + result.removed;
    if (result.failed) {
      const kinds = Object.entries(result.errors).map(([k, n]) => `${k} ${n}`).join(", ");
      const hint = Object.keys(result.errors).map((k) => KIND_HINT[k as CalendarErrorKind]).find(Boolean);
      this.warn(`구글 캘린더 복사 ${result.failed}건 실패(${kinds}). 위키에는 저장돼 있고 다음 동기화 때 다시 해요${hint ? `. ${hint}` : ""}`);
    }
    if (changed) this.log(`구글 캘린더에 반영: 추가 ${result.added}, 수정 ${result.updated}, 삭제 ${result.removed}${result.deferred ? `, 다음으로 미룸 ${result.deferred}` : ""}`);
    return result;
  }
}
