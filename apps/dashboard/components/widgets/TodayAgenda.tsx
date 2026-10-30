import { addDays, type Event } from "@hsh/core";
import { isPast, orderAgenda } from "@/lib/view";
import { AutoScroll } from "../ui/AutoScroll";
import { MemberDots, type MemberMap } from "./MemberDot";
import s from "./TodayAgenda.module.css";

function whenOf(e: Event) {
  if (e.allDay || !e.start) return "종일";
  return e.start;
}

/**
 * 오늘 일정: 남은 일정이 먼저(시간순), 지난 일정은 아래에 흐리게. 내일 첫 일정 1줄은 고정.
 * 넘치면 목록만 천천히 자동 순환한다(AutoScroll). '외 n건' 없이 전부 싣는다.
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
  const { upcoming, past } = orderAgenda(events, today, nowTime);
  const list = [...upcoming, ...past];
  const tomorrow = events.find((e) => e.date === addDays(today, 1));

  return (
    <section className={s.agenda} aria-labelledby="agenda-title">
      <h2 id="agenda-title" className={s.title}>
        오늘
      </h2>
      {list.length === 0 ? (
        <p className={s.empty}>오늘은 일정이 없어요</p>
      ) : (
        <AutoScroll className={s.scroll}>
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
