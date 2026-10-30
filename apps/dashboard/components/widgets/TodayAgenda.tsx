"use client";
import { useState } from "react";
import { usePersistedFlag } from "@/hooks/usePersistedFlag";
import { addDays, type Event } from "@hsh/core";
import { isPast, orderAgenda } from "@/lib/view";
import { AutoScroll } from "../ui/AutoScroll";
import { MemberDots, type MemberMap } from "./MemberDot";
import s from "./TodayAgenda.module.css";

function whenOf(e: Event) {
  if (e.allDay || !e.start) return "종일";
  return e.start;
}

export const AGENDA_PAUSED_KEY = "hsh.agenda.autoscroll-paused";

/** 자동 넘김 멈춤/켜기 토글 아이콘(일시정지/재생). 색은 currentColor(토큰) */
function PauseIcon({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="currentColor">
      {paused ? <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
    </svg>
  );
}

/**
 * 오늘 일정: 남은 일정이 먼저(시간순), 지난 일정은 아래에 흐리게. 내일 첫 일정 1줄은 고정.
 * 넘치면 목록만 천천히 자동 순환한다(AutoScroll). '외 n건' 없이 전부 싣는다.
 * 넘칠 때만 헤더 오른쪽에 자동 넘김 멈춤/켜기 버튼이 나온다(WCAG 2.2.2). 끈 상태는 localStorage에 남는다.
 */
export function TodayAgenda({
  events,
  today,
  nowTime,
  members,
}: {
  events: Event[];
  today: string;
  nowTime: string;
  members: MemberMap;
}) {
  const [paused, setPaused] = usePersistedFlag(AGENDA_PAUSED_KEY);
  const [overflowing, setOverflowing] = useState(false);
  const { upcoming, past } = orderAgenda(events, today, nowTime);
  const list = [...upcoming, ...past];
  const tomorrow = events.find((e) => e.date === addDays(today, 1));

  return (
    <section className={s.agenda} aria-labelledby="agenda-title">
      <div className={s.head}>
        <h2 id="agenda-title" className={s.title}>
          오늘
        </h2>
        {overflowing && (
          <button type="button" className={s.toggle} aria-pressed={paused} aria-label={paused ? "자동 넘김 켜기" : "자동 넘김 멈춤"} onClick={() => setPaused(!paused)}>
            <PauseIcon paused={paused} />
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className={s.empty}>오늘은 일정이 없어요</p>
      ) : (
        <AutoScroll className={s.scroll} paused={paused} onOverflowChange={setOverflowing}>
          <ol className={s.list}>
            {list.map((e) => (
              <li key={e.id} className={s.item} data-past={isPast(e, nowTime) || undefined}>
                <span className={s.when}>{whenOf(e)}</span>
                <span className={s.what}>
                  <span className={s.name}>{e.title}</span>
                  <MemberDots ids={e.members} members={members} />
                </span>
              </li>
            ))}
          </ol>
        </AutoScroll>
      )}
      {tomorrow && (
        <p className={s.tomorrow}>
          <span className={s.tomorrowLabel}>내일</span>
          <span className={s.tomorrowWhat}>
            {whenOf(tomorrow)} {tomorrow.title}
          </span>
        </p>
      )}
    </section>
  );
}
