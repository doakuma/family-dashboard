import { WEEKDAYS_KO, monthGrid, weekdayOf, type Event } from "@hsh/core";
import { colorOf } from "@/lib/palette";
import type { MemberMap } from "./MemberDot";
import s from "./MonthCalendar.module.css";

const PER_CELL = 2;

/** 일요일 시작 월간 달력. 칸당 최대 2건 + "외 n건". 색 막대는 첫 구성원 색. */
export function MonthCalendar({ events, today, members }: { events: Event[]; today: string; members: MemberMap }) {
  const month = today.slice(0, 7);
  const days = monthGrid(month);
  const byDate = new Map<string, Event[]>();
  for (const e of events) {
    if (e.date < days[0]! || e.date > days.at(-1)!) continue;
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }
  const barColor = (e: Event) => {
    const id = e.members.find((m) => m !== "family") ?? e.members[0];
    return colorOf(members.get(id ?? "")?.color);
  };

  return (
    <section className={s.calendar} aria-label={`${Number(month.slice(5))}월 달력`}>
      <h2 className={s.month}>
        {Number(month.slice(5))}월 <span className={s.year}>{month.slice(0, 4)}</span>
      </h2>
      <div className={s.weekdays} aria-hidden>
        {WEEKDAYS_KO.map((w, i) => (
          <span key={w} data-dow={i}>
            {w}
          </span>
        ))}
      </div>
      <ol className={s.grid} style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const list = byDate.get(d) ?? [];
          const more = list.length - PER_CELL;
          return (
            <li
              key={d}
              className={s.cell}
              data-dow={weekdayOf(d)}
              data-other={d.slice(0, 7) !== month || undefined}
              data-past={d < today || undefined}
              data-today={d === today || undefined}
              aria-current={d === today ? "date" : undefined}
            >
              <span className={s.num}>{Number(d.slice(8))}</span>
              {list.slice(0, PER_CELL).map((e) => (
                <span key={e.id} className={s.event} data-done={e.done || undefined} style={{ ["--bar" as string]: barColor(e) }}>
                  {e.title}
                </span>
              ))}
              {more > 0 && <span className={s.more}>외 {more}건</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
