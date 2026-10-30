"use client";
import { addDays, timeIn, todayIn, type ApiState } from "@hsh/core";
import { useRef, type MouseEvent } from "react";
import { useDisplayTone } from "@/hooks/useDisplayTone";
import type { BrowseHandlers } from "@/hooks/useDashboardView";
import { useNow } from "@/hooks/useNow";
import { displayOf, isNight, type MonthStatus } from "@/lib/view";
import { canMove, viewMonthOf, type DashboardViewState } from "@/lib/view-state";
import { Checklist } from "./widgets/Checklist";
import { ClockHeader } from "./widgets/ClockHeader";
import { DaySheet } from "./widgets/DaySheet";
import { DdayList } from "./widgets/DdayList";
import { LastUpdated } from "./widgets/LastUpdated";
import { toMemberMap } from "./widgets/MemberDot";
import { MonthCalendar } from "./widgets/MonthCalendar";
import { NightView } from "./widgets/NightView";
import { TodayAgenda } from "./widgets/TodayAgenda";
import { WeatherStrip } from "./widgets/WeatherStrip";
import s from "./Dashboard.module.css";

/** 야간 화면을 깨운 탭에서 이 시간(ms) 안에 오는 클릭은 무시 */
const WAKE_CLICK_GUARD_MS = 600;

export interface DashboardProps {
  state: ApiState;
  /** 마지막 폴링이 실패했는지 */
  offline: boolean;
  /** 보는 달의 일정 상태(lib/view monthStatus). ready가 아니면 달력 칸은 비워 두고 불러오는 중(또는 실패)으로 표시한다 */
  monthStatus?: MonthStatus;
  /** 시안·테스트용 고정 시각 (ISO) */
  at?: string;
  /** 시안·테스트용 강제 모드 */
  mode?: "day" | "night";
  /**
   * 달력 둘러보기(보기 터치). 보기 상태와 콜백은 상위(Screen의 useDashboardView)가 갖고 위젯은 표시만 한다.
   * 없으면 보기 전용이다(/setup 미리보기처럼 재사용하는 곳).
   */
  browse?: { view: DashboardViewState; handlers: BrowseHandlers };
}

export function Dashboard({ state, offline, monthStatus = "ready", at, mode, browse }: DashboardProps) {
  // 서버 렌더 시각(updatedAt)으로 시작해야 서버 HTML과 첫 클라이언트 렌더가 같다
  const now = useNow(at, state.updatedAt);
  const today = todayIn(now);
  const time = timeIn(now);
  const night = mode ? mode === "night" : isNight(time);
  const members = toMemberMap(state.members);
  // 고정 시각(시안)이어도 갱신 지연 판정은 실제 시각으로 한다
  const clockNow = at ? new Date(state.updatedAt) : now;

  // 야간에 만지면(lastTouchAt) 어두운 톤 그대로 낮 화면 구성으로 바뀌고, 120초 뒤 터치 상태가 풀리면 야간 화면으로 돌아간다.
  const touched = browse?.view.lastTouchAt !== undefined;
  const display = displayOf(night, touched);
  useDisplayTone(display.mode, display.tone);
  const view = browse?.view;
  const handlers = browse?.handlers;
  const baseMonth = today.slice(0, 7);
  const month = viewMonthOf(baseMonth, view?.monthOffset ?? 0);
  const sheetDate = view?.selectedDate;

  const sheetOpen = Boolean(handlers && view && sheetDate);

  // 야간 화면을 깨우는 첫 터치는 화면만 깨운다: 깨어난 낮 화면이 같은 자리에 날짜 칸을 그려서 그 탭이 칸을 눌러 버리지 않게 클릭을 한 번 삼킨다.
  const wakeUntil = useRef(0);
  const onPointerDown = () => {
    if (display.mode === "night") wakeUntil.current = Date.now() + WAKE_CLICK_GUARD_MS;
    handlers?.onTouch();
  };
  const swallowWakeClick = (e: MouseEvent) => {
    if (Date.now() < wakeUntil.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    // 터치·키 입력은 어디서든(시트의 어두운 바깥 포함) 마지막 터치 시각을 갱신한다. display: contents라 배치에는 영향이 없다.
    <div className={s.root} onPointerDownCapture={onPointerDown} onKeyDownCapture={handlers?.onTouch} onClickCapture={swallowWakeClick}>
      {display.mode === "night" ? (
        <main className={s.night}>
          {/* 자정 전이면 다음 날 아침, 자정 이후면 그날 아침 일정을 보여 준다. */}
          <NightView now={now} date={time >= "23:00" ? addDays(today, 1) : today} label={time >= "23:00" ? "내일" : "오늘"} events={state.events} members={members} />
          <LastUpdated at={state.updatedAt} offline={offline} now={clockNow} />
        </main>
      ) : (
        <main className={s.board} inert={sheetOpen || undefined}>
          <div className={s.clock}>
            <ClockHeader now={now} familyName={state.familyName} />
          </div>
          <div className={s.weather}>
            <WeatherStrip days={state.weather} today={today} />
          </div>
          <div className={s.agenda}>
            <TodayAgenda events={state.events} today={today} nowTime={time} members={members} />
          </div>
          <div className={s.calendar}>
            <MonthCalendar
              events={monthStatus === "ready" ? state.events : []}
              status={monthStatus}
              today={today}
              members={members}
              month={month}
              onSelectDate={handlers?.onSelectDate}
              onChangeMonth={handlers?.onChangeMonth}
              canMove={{ prev: canMove(baseMonth, view?.monthOffset ?? 0, -1), next: canMove(baseMonth, view?.monthOffset ?? 0, 1) }}
            />
          </div>
          {/* 체크리스트·다가오는 날은 터치 반응이 없다(누를 수 있어 보이면 안 된다) */}
          <div className={s.checklist}>
            <Checklist tasks={state.tasks} members={members} />
          </div>
          <div className={s.dday}>
            <DdayList anniversaries={state.anniversaries} today={today} members={members} />
          </div>
          <LastUpdated at={state.updatedAt} offline={offline} now={clockNow} />
        </main>
      )}
      {handlers && view && sheetDate && (
        <DaySheet date={sheetDate} events={state.events} members={members} eventId={view.selectedEventId} onSelectEvent={handlers.onSelectEvent} onClose={handlers.onCloseSheet} />
      )}
    </div>
  );
}
