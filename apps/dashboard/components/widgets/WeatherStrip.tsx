import { diffDays, weekdayKo, type WeatherDay } from "@hsh/core";
import { WeatherIcon } from "./WeatherIcon";
import s from "./WeatherStrip.module.css";

/** 오늘~6일 후. 강수확률 60% 이상만 숫자로 보여 준다. */
export function WeatherStrip({ days, today }: { days: WeatherDay[]; today: string }) {
  if (!days.length) return <p className={s.empty}>날씨 정보를 가져오지 못했어요</p>;
  return (
    <section className={s.strip} aria-label="7일 날씨">
      <ol className={s.days}>
        {days.slice(0, 7).map((d) => {
          const n = diffDays(today, d.date);
          return (
            <li key={d.date} className={s.day} data-today={n === 0 || undefined}>
              <span className={s.label}>{n === 0 ? "오늘" : n === 1 ? "내일" : weekdayKo(d.date)}</span>
              <span className={s.icon}>
                <WeatherIcon icon={d.icon} />
              </span>
              <span className={s.temp}>
                <span className={s.max}>{d.max}°</span>
                <span className={s.min}>{d.min}°</span>
              </span>
              <span className={s.pop}>{d.pop !== undefined && d.pop >= 60 ? `${d.pop}%` : ""}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
