"use client";
import { WEEKDAYS_KO, monthGrid, weekdayOf, type Event } from "@hsh/core";
import { useRef } from "react";
import { useSwipe } from "@/hooks/useSwipe";
import { colorOf } from "@/lib/palette";
import { LIMITS, limit } from "@/lib/view";
import type { MemberMap } from "./MemberDot";
import s from "./MonthCalendar.module.css";

export interface MonthCalendarProps {
  events: Event[];
  /** 그 달 일정이 아직 안 왔거나(loading) 못 가져왔을 때(failed): 칸을 비워 두고 누를 수 없게 하며 안내를 보인다. 기본 ready */
  status?: "ready" | "loading" | "failed";
  today: string;
  members: MemberMap;
  /** 보여 줄 달(YYYY-MM). 없으면 오늘이 속한 달 */
  month?: string;
  /** 있으면 날짜 칸이 눌린다(그날 일정 시트). 없으면 보기 전용 */
  onSelectDate?: (date: string) => void;
  /** 있으면 ‹ › 버튼과 좌우 스와이프로 달을 옮긴다. 없으면 보기 전용 */
  onChangeMonth?: (delta: -1 | 1) => void;
  /** 더 이전/다음 달이 없을 때(범위 끝) 버튼을 비활성으로 */
  canMove?: { prev: boolean; next: boolean };
}

/**
 * 일요일 시작 월간 달력. 칸당 최대 2건 + "외 n건". 색 막대는 첫 구성원 색.
 * 표시 컴포넌트: 일정 목록과 달만 받고, 보기 상태(어느 달·어느 날짜)는 상위가 갖는다. 콜백이 없으면 보기 전용이다.
 */
export function MonthCalendar({ events, status = "ready", today, members, month = today.slice(0, 7), onSelectDate, onChangeMonth, canMove = { prev: true, next: true } }: MonthCalendarProps) {
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

  const root = useRef<HTMLElement>(null);
  useSwipe(root, onChangeMonth && ((dir) => onChangeMonth(dir === "next" ? 1 : -1)));
  const label = `${Number(month.slice(5))}월`;

  return (
    <section ref={root} className={s.calendar} aria-label={`${label} 달력`} data-browsable={onChangeMonth || onSelectDate ? "" : undefined} aria-busy={status === "loading" || undefined}>
      <div className={s.head}>
        <h2 className={s.month}>
          {label} <span className={s.year}>{month.slice(0, 4)}</span>
        </h2>
        {status !== "ready" && (
          <p className={s.status} role="status">
            {status === "loading" ? "일정을 불러오는 중이에요" : "이 달 일정을 가져오지 못했어요. 다시 시도하고 있어요"}
          </p>
        )}
        {onChangeMonth && (
          <div className={s.nav}>
            <button type="button" className={s.navBtn} onClick={() => onChangeMonth(-1)} disabled={!canMove.prev} aria-label="이전 달">
              <span aria-hidden="true">‹</span>
            </button>
            <button type="button" className={s.navBtn} onClick={() => onChangeMonth(1)} disabled={!canMove.next} aria-label="다음 달">
              <span aria-hidden="true">›</span>
            </button>
          </div>
        )}
      </div>
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
          const { shown, more } = limit(list, LIMITS.calendarCell);
          const content = (
            <>
              <span className={s.num}>{Number(d.slice(8))}</span>
              {shown.map((e) => (
                <span key={e.id} className={s.event} data-done={e.done || undefined} style={{ ["--bar" as string]: barColor(e) }}>
                  {e.title}
                </span>
              ))}
              {more > 0 && <span className={s.more}>외 {more}건</span>}
            </>
          );
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
              {onSelectDate && status === "ready" ? (
                <button
                  type="button"
                  className={s.cellBtn}
                  data-date={d}
                  aria-haspopup="dialog"
                  aria-label={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일${list.length ? `, 일정 ${list.length}건` : ", 일정 없음"}`}
                  onClick={() => onSelectDate(d)}
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
