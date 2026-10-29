import { timeIn, todayIn, weekdayKo } from "@hsh/core";
import s from "./ClockHeader.module.css";

export function ClockHeader({ now, familyName }: { now: Date; familyName?: string }) {
  const today = todayIn(now);
  const [, m, d] = today.split("-");
  return (
    <header className={s.clock}>
      {familyName && <p className={s.family}>{familyName}</p>}
      <time className={s.time} dateTime={now.toISOString()}>
        {timeIn(now)}
      </time>
      <p className={s.date}>
        {Number(m)}월 {Number(d)}일 {weekdayKo(today)}요일
      </p>
    </header>
  );
}
