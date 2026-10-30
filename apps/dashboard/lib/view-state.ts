// 달력 둘러보기의 '보기 상태'와 자동 복귀 판단. React 없이 테스트할 수 있게 순수 함수로 둔다.
// 위키 데이터(DashboardState)와 섞지 않는다: 이 상태는 화면에만 있고 어디에도 저장·전송되지 않는다.
import { MONTH_MAX, MONTH_MIN, addMonths } from "@hsh/core";

/** 마지막 터치 뒤 이만큼(ms) 조용하면 시트를 닫고 이번 달·오늘 화면(야간이면 야간 화면)으로 돌아간다 */
export const IDLE_RESET_MS = 120_000;

export interface DashboardViewState {
  /** 이번 달에서 몇 달 떨어진 달을 보는지 (0 = 이번 달) */
  monthOffset: number;
  /** 시트로 연 날짜(YYYY-MM-DD). 있으면 시트가 열려 있다 */
  selectedDate?: string;
  /** 시트 안에서 고른 일정 id. 있으면 상세, 없으면 그날 목록 */
  selectedEventId?: string;
  /** 마지막으로 화면을 만진 시각(ms). 없으면 지금은 손대지 않은 기본 화면 */
  lastTouchAt?: number;
}

export const INITIAL_VIEW: DashboardViewState = { monthOffset: 0 };

export type ViewAction =
  | { type: "touch"; at: number }
  | { type: "selectDate"; date: string; at: number }
  /** id가 없으면 상세에서 목록으로 돌아간다 */
  | { type: "selectEvent"; id?: string; at: number }
  | { type: "closeSheet"; at: number }
  /** baseMonth: 이번 달(YYYY-MM). 범위(MONTH_MIN~MONTH_MAX)를 넘는 이동은 끝 달에 멈춘다 */
  | { type: "changeMonth"; delta: number; baseMonth: string; at: number }
  | { type: "reset" }
  /** 시각이 지났는지 확인해서 지났으면 reset과 같다 */
  | { type: "idleCheck"; now: number };

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/** 지금 보는 달(YYYY-MM) */
export function viewMonthOf(baseMonth: string, monthOffset: number): string {
  return addMonths(baseMonth, monthOffset);
}

/** 손을 뗀 채 IDLE_RESET_MS가 지났는지 (정확히 120초가 되는 순간부터 true) */
export function isIdleExpired(view: DashboardViewState, now: number): boolean {
  return view.lastTouchAt !== undefined && now - view.lastTouchAt >= IDLE_RESET_MS;
}

/** 자동 복귀까지 남은 ms. 손댄 적 없으면 undefined(타이머 불필요) */
export function msUntilReset(view: DashboardViewState, now: number): number | undefined {
  return view.lastTouchAt === undefined ? undefined : Math.max(0, view.lastTouchAt + IDLE_RESET_MS - now);
}

export function viewReducer(view: DashboardViewState, a: ViewAction): DashboardViewState {
  switch (a.type) {
    case "touch":
      return { ...view, lastTouchAt: a.at };
    case "selectDate":
      return { ...view, selectedDate: a.date, selectedEventId: undefined, lastTouchAt: a.at };
    case "selectEvent":
      return view.selectedDate ? { ...view, selectedEventId: a.id, lastTouchAt: a.at } : { ...view, lastTouchAt: a.at };
    case "closeSheet":
      return { ...view, selectedDate: undefined, selectedEventId: undefined, lastTouchAt: a.at };
    case "changeMonth": {
      // 달이 바뀌면 시트는 닫는다(고른 날짜가 보는 달 밖일 수 있다)
      const current = viewMonthOf(a.baseMonth, view.monthOffset);
      const target = addMonths(current, a.delta);
      const offset = monthIndex(target) - monthIndex(a.baseMonth);
      const moved = target !== current;
      return { monthOffset: offset, selectedDate: moved ? undefined : view.selectedDate, selectedEventId: moved ? undefined : view.selectedEventId, lastTouchAt: a.at };
    }
    case "reset":
      return INITIAL_VIEW;
    case "idleCheck":
      return isIdleExpired(view, a.now) ? INITIAL_VIEW : view;
  }
}

/** ‹ › 버튼을 더 누를 수 있는지 (범위 끝이면 false) */
export function canMove(baseMonth: string, monthOffset: number, delta: -1 | 1): boolean {
  const m = viewMonthOf(baseMonth, monthOffset);
  return delta < 0 ? m > MONTH_MIN : m < MONTH_MAX;
}
