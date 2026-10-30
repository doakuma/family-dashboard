import { diffDays, nextOccurrence, weekdayKo, type PublicAnniversary } from "@hsh/core";
import { LIMITS } from "@/lib/view";
import { MemberDots, type MemberMap } from "./MemberDot";
import s from "./DdayList.module.css";

/** 다가오는 기념일 가까운 순 5개. 생일이면 몇 살이 되는지 함께 보여 준다. */
export function DdayList({ anniversaries, today, members }: { anniversaries: PublicAnniversary[]; today: string; members: MemberMap }) {
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
          // 서버가 계산해 준 나이. 날짜가 어긋나면(자정 직후 갱신 전) 보여 주지 않는다.
          const turning = a.turns?.date === date ? a.turns.age : undefined;
          return (
            <li key={`${a.monthDay}-${a.title}`} className={s.item} data-soon={n <= 30 || undefined}>
              <span className={s.d}>
                {n === 0 ? "오늘" : `D-${n}`}
              </span>
              <span className={s.what}>
                {a.title}
                {a.member && a.member !== "family" && (
                  <>
                    {" "}
                    <MemberDots ids={[a.member]} members={members} size="sm" />
                  </>
                )}
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
