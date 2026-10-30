import { diffDays, nextOccurrence, weekdayKo, type Anniversary } from "@hsh/core";
import { colorOf } from "@/lib/palette";
import { LIMITS } from "@/lib/view";
import type { MemberMap } from "./MemberDot";
import s from "./DdayList.module.css";

/** 다가오는 기념일 가까운 순 5개. 생일이면 몇 살이 되는지 함께 보여 준다. */
export function DdayList({ anniversaries, today, members }: { anniversaries: Anniversary[]; today: string; members: MemberMap }) {
  const upcoming = anniversaries
    .map((a) => ({ a, date: nextOccurrence(a.monthDay, today) }))
    .sort((x, y) => x.date.localeCompare(y.date))
    .slice(0, LIMITS.dday);

  return (
    <section className={s.dday} aria-labelledby="dday-title">
      <h2 id="dday-title" className={s.title}>
        다가오는 날
      </h2>
      <ol className={s.list}>
        {upcoming.map(({ a, date }) => {
          const n = diffDays(today, date);
          const m = a.member ? members.get(a.member) : undefined;
          const turning = m?.birth && /생일/.test(a.title) ? Number(date.slice(0, 4)) - Number(m.birth.slice(0, 4)) : undefined;
          return (
            <li key={`${a.monthDay}-${a.title}`} className={s.item} data-soon={n <= 30 || undefined}>
              <span className={s.d} style={n <= 30 && m && m.id !== "family" ? { color: colorOf(m.color) } : undefined}>
                {n === 0 ? "오늘" : `D-${n}`}
              </span>
              <span className={s.what}>
                {a.title}
                {turning !== undefined && <span className={s.age}> {turning}살</span>}
              </span>
              <span className={s.date}>
                {Number(date.slice(5, 7))}.{Number(date.slice(8))} {weekdayKo(date)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
