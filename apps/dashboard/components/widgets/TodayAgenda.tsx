import { addDays, type Event } from "@hsh/core";
import { MemberDots, type MemberMap } from "./MemberDot";
import s from "./TodayAgenda.module.css";

const MAX = 6;

function whenOf(e: Event) {
  if (e.allDay || !e.start) return "종일";
  return e.start;
}

/** 지난 일정인지: 종일 일정은 하루 내내 '진행 중' */
function isPast(e: Event, nowTime: string) {
  if (e.done) return true;
  if (e.allDay || !e.start) return false;
  return (e.end ?? e.start) < nowTime;
}

/** 오늘 일정 시간순, 지난 일정 흐리게, 내일 첫 일정 1줄 */
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
  const list = events.filter((e) => e.date === today);
  const tomorrow = events.find((e) => e.date === addDays(today, 1));
  const shown = list.slice(0, MAX);

  return (
    <section className={s.agenda} aria-labelledby="agenda-title">
      <h2 id="agenda-title" className={s.title}>
        오늘
      </h2>
      {shown.length === 0 ? (
        <p className={s.empty}>오늘은 일정이 없어요</p>
      ) : (
        <ol className={s.list}>
          {shown.map((e) => (
            <li key={e.id} className={s.item} data-past={isPast(e, nowTime) || undefined}>
              <span className={s.when}>{whenOf(e)}</span>
              <span className={s.what}>
                <span className={s.name}>{e.title}</span>
                <MemberDots ids={e.members} members={members} />
              </span>
            </li>
          ))}
          {list.length > MAX && <li className={s.more}>외 {list.length - MAX}건</li>}
        </ol>
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
