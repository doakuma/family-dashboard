"use client";
import { addDays, timeIn, todayIn, type ApiState } from "@hsh/core";
import { useEffect } from "react";
import { isNight } from "@/lib/view";
import { useNow } from "@/hooks/useNow";
import { Checklist } from "./widgets/Checklist";
import { ClockHeader } from "./widgets/ClockHeader";
import { DdayList } from "./widgets/DdayList";
import { LastUpdated } from "./widgets/LastUpdated";
import { toMemberMap } from "./widgets/MemberDot";
import { MonthCalendar } from "./widgets/MonthCalendar";
import { NightView } from "./widgets/NightView";
import { TodayAgenda } from "./widgets/TodayAgenda";
import { WeatherStrip } from "./widgets/WeatherStrip";
import s from "./Dashboard.module.css";

export interface DashboardProps {
  state: ApiState;
  /** 마지막 폴링이 실패했는지 */
  offline: boolean;
  /** 시안·테스트용 고정 시각 (ISO) */
  at?: string;
  /** 시안·테스트용 강제 모드 */
  mode?: "day" | "night";
}

export function Dashboard({ state, offline, at, mode }: DashboardProps) {
  // 서버 렌더 시각(updatedAt)으로 시작해야 서버 HTML과 첫 클라이언트 렌더가 같다
  const now = useNow(at, state.updatedAt);
  const today = todayIn(now);
  const time = timeIn(now);
  const night = mode ? mode === "night" : isNight(time);
  const members = toMemberMap(state.members);
  // 고정 시각(시안)이어도 갱신 지연 판정은 실제 시각으로 한다
  const clockNow = at ? new Date(state.updatedAt) : now;

  // body 배경까지 반영하려고 html에 건다. 모드(day/night)와 톤(normal/dim)은 따로다:
  // 지금은 야간 = 어두운 톤이지만, 나중에 "야간 화면을 만졌을 때 어두운 톤의 낮 화면"처럼 둘을 따로 고를 수 있게 축을 나눠 둔다.
  const tone = night ? "dim" : "normal";
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mode = night ? "night" : "day";
    root.dataset.tone = tone;
    return () => {
      root.dataset.mode = "day";
      root.dataset.tone = "normal";
    };
  }, [night, tone]);

  if (night) {
    // 자정 전이면 다음 날 아침, 자정 이후면 그날 아침 일정을 보여 준다.
    const morning = time >= "23:00" ? addDays(today, 1) : today;
    return (
      <main className={s.night}>
        <NightView now={now} date={morning} label={time >= "23:00" ? "내일" : "오늘"} events={state.events} members={members} />
        <LastUpdated at={state.updatedAt} offline={offline} now={clockNow} />
      </main>
    );
  }

  return (
    <main className={s.board}>
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
        <MonthCalendar events={state.events} today={today} members={members} />
      </div>
      <div className={s.checklist}>
        <Checklist tasks={state.tasks} members={members} />
      </div>
      <div className={s.dday}>
        <DdayList anniversaries={state.anniversaries} today={today} members={members} />
      </div>
      <LastUpdated at={state.updatedAt} offline={offline} now={clockNow} />
    </main>
  );
}
