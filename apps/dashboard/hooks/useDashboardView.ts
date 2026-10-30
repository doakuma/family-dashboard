"use client";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { INITIAL_VIEW, isIdleExpired, msUntilReset, viewMonthOf, viewReducer } from "@/lib/view-state";

/** 위젯이 받는 콜백 묶음. 없으면 그 위젯은 보기 전용이다. */
export interface BrowseHandlers {
  onTouch: () => void;
  onSelectDate: (date: string) => void;
  /** id 없이 부르면 상세에서 그날 목록으로 돌아간다 */
  onSelectEvent: (id?: string) => void;
  onCloseSheet: () => void;
  onChangeMonth: (delta: -1 | 1) => void;
}

/**
 * 달력 둘러보기의 보기 상태(DashboardViewState)를 들고 있다. 폴링과 따로 살아서 1분 폴링이 와도 유지되고,
 * 마지막 터치 뒤 120초가 지나면(IDLE_RESET_MS) 초기 상태(이번 달·시트 닫힘)로만 돌아간다.
 * baseMonth: 오늘이 속한 달(YYYY-MM). 월 이동 계산의 기준.
 */
export function useDashboardView(baseMonth: string) {
  const [view, dispatch] = useReducer(viewReducer, INITIAL_VIEW);

  // 자동 복귀 타이머: 터치할 때마다 새로 건다. 일찍 깨어나면(타이머 오차) 남은 시간만큼 다시 건다.
  useEffect(() => {
    if (view.lastTouchAt === undefined) return;
    let id: ReturnType<typeof setTimeout>;
    const arm = () => {
      const wait = msUntilReset(view, Date.now()) ?? 0;
      id = setTimeout(() => {
        if (isIdleExpired(view, Date.now())) dispatch({ type: "idleCheck", now: Date.now() });
        else arm();
      }, wait);
    };
    arm();
    return () => clearTimeout(id);
  }, [view]);

  const handlers = useMemo<BrowseHandlers>(
    () => ({
      onTouch: () => dispatch({ type: "touch", at: Date.now() }),
      onSelectDate: (date) => dispatch({ type: "selectDate", date, at: Date.now() }),
      onSelectEvent: (id) => dispatch({ type: "selectEvent", id, at: Date.now() }),
      onCloseSheet: () => dispatch({ type: "closeSheet", at: Date.now() }),
      onChangeMonth: (delta) => dispatch({ type: "changeMonth", delta, baseMonth, at: Date.now() }),
    }),
    [baseMonth],
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const month = viewMonthOf(baseMonth, view.monthOffset);
  return { view, month, handlers, reset };
}
