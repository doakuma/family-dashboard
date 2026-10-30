import { timeIn, type Event } from "@hsh/core";
import { MemberDots, type MemberMap } from "./MemberDot";
import s from "./NightView.module.css";

/** 야간: 시계와 아침 일정만 크게. 번인·눈부심을 줄이려고 나머지는 숨긴다. */
export function NightView({
  now,
  date,
  label,
  events,
  members,
}: {
  now: Date;
  date: string;
  label: string;
  events: Event[];
  members: MemberMap;
}) {
  const list = events.filter((e) => e.date === date && !e.done).slice(0, 4);
  return (
    <div className={s.night}>
      <time className={s.time} dateTime={now.toISOString()}>
        {timeIn(now)}
      </time>
      <section className={s.next} aria-label={`${label} 일정`}>
        <h2 className={s.label}>{label}</h2>
        {list.length === 0 ? (
          <p className={s.empty}>일정 없음</p>
        ) : (
          <ol className={s.list}>
            {list.map((e) => (
              <li key={e.id} className={s.item}>
                <span className={s.when}>{e.allDay || !e.start ? "종일" : e.start}</span>
                <span className={s.what}>{e.title}</span>
                <MemberDots ids={e.members} members={members} size="sm" />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
