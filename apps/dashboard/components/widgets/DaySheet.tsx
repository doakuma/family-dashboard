"use client";
import { eventSortKey, weekdayKo, type Event } from "@hsh/core";
import { useEffect, useRef } from "react";
import { whenLabel } from "@/lib/view";
import { Sheet } from "../ui/Sheet";
import { MemberDots, type MemberMap } from "./MemberDot";
import s from "./DaySheet.module.css";

export const SHEET_TITLE_ID = "day-sheet-title";
/** 상세 화면의 안내 문구. 태블릿은 쓰지 않는다 - 고치는 곳은 슬랙뿐이다. */
export const EDIT_NOTICE = "고치려면 슬랙에서 말해주세요";

/**
 * 날짜 하나의 일정을 오른쪽 시트로 보여 준다(보기 전용). 달력 칸의 "외 n건"에 가려진 일정도 전부 나온다.
 * 일정을 누르면 시간·구성원·공유 그룹과 안내 문구가 나오는 상세로 바뀐다. 데이터는 바꾸지 않는다.
 * 표시 컴포넌트: 일정 목록과 선택 id, 콜백만 받는다.
 */
export function DaySheet({
  date,
  events,
  members,
  eventId,
  onSelectEvent,
  onClose,
}: {
  date: string;
  /** 전체 일정(날짜는 여기서 거른다) */
  events: readonly Event[];
  members: MemberMap;
  /** 상세로 보는 일정 id (없으면 목록) */
  eventId?: string;
  onSelectEvent: (id?: string) => void;
  onClose: () => void;
}) {
  const list = events.filter((e) => e.date === date).sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  const picked = eventId ? list.find((e) => e.id === eventId) : undefined; // 폴링으로 사라진 일정이면 목록으로
  const [, m, d] = date.split("-").map(Number);

  // 상세로 가면 '목록으로'에, 목록으로 돌아오면 방금 보던 일정 버튼에 포커스
  const body = useRef<HTMLDivElement>(null);
  const lastPicked = useRef<string | undefined>(undefined);
  const pickedId = picked?.id;
  useEffect(() => {
    if (pickedId) body.current?.querySelector<HTMLElement>("[data-back]")?.focus({ preventScroll: true });
    else if (lastPicked.current) body.current?.querySelector<HTMLElement>(`[data-event-id="${lastPicked.current}"]`)?.focus({ preventScroll: true });
    lastPicked.current = pickedId;
  }, [pickedId]);

  return (
    <Sheet onClose={onClose} labelledBy={SHEET_TITLE_ID} getReturnFocus={() => document.querySelector<HTMLElement>(`[data-date="${date}"]`)}>
      <header className={s.head}>
        <h2 id={SHEET_TITLE_ID} className={s.title} tabIndex={-1} data-initial-focus>
          {m}월 {d}일 <span className={s.dow}>{weekdayKo(date)}요일</span>
        </h2>
        <button type="button" className={s.close} onClick={onClose}>
          닫기
        </button>
      </header>
      <div ref={body} className={s.body}>
        {picked ? (
          <article className={s.detail} aria-label="일정 상세">
            <button type="button" className={s.back} data-back onClick={() => onSelectEvent(undefined)}>
              <span aria-hidden="true">‹</span> 목록으로
            </button>
            <h3 className={s.eventTitle} data-done={picked.done || undefined}>
              {picked.title}
            </h3>
            <dl className={s.facts}>
              <div>
                <dt>시간</dt>
                <dd>{whenLabel(picked)}</dd>
              </div>
              <div>
                <dt>구성원</dt>
                <dd>
                  {picked.members.map((id) => members.get(id)?.name ?? id).join(", ")}
                  <MemberDots ids={picked.members} members={members} />
                </dd>
              </div>
              {picked.share && (
                <div>
                  <dt>공유 그룹</dt>
                  <dd>{picked.share}</dd>
                </div>
              )}
              {picked.done && (
                <div>
                  <dt>상태</dt>
                  <dd>완료</dd>
                </div>
              )}
            </dl>
            <p className={s.notice}>{EDIT_NOTICE}</p>
          </article>
        ) : list.length === 0 ? (
          <p className={s.empty}>이 날은 일정이 없어요</p>
        ) : (
          <ol className={s.list} aria-label={`일정 ${list.length}건`}>
            {list.map((e) => (
              <li key={e.id}>
                <button type="button" className={s.item} data-event-id={e.id} data-done={e.done || undefined} onClick={() => onSelectEvent(e.id)}>
                  <span className={s.when}>{whenLabel(e)}</span>
                  <span className={s.what}>{e.title}</span>
                  <MemberDots ids={e.members} members={members} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Sheet>
  );
}
