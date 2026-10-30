"use client";
import { useMemo, useState } from "react";
import { colorOf } from "@/lib/palette";
import { birthdayAnniversaries, extraAnniversaries, toPreviewState } from "@/lib/setup/build";
import { findRegion } from "@hsh/core";
import { COLOR_LABELS, isPickableColor } from "@/lib/setup/colors";
import { memberLabel, validMonthDay } from "@/lib/setup/validate";
import { DashboardPreview } from "../DashboardPreview";
import s from "../setup.module.css";
import type { StepProps } from "./types";

export interface ReviewProps extends StepProps {
  /** 세팅 전인데 이전 세팅 파일이 남아 있어 덮어쓰기 확인이 필요한가 */
  needsOverwrite: boolean;
  /** 서버가 위키에 쓸 수 없는 설정인가 (WIKI_REPO_PATH 없음) */
  writable: boolean;
  /** 서버 응답 등 마지막 단계에서만 생기는 오류 문구 */
  message?: string;
}

/** 6단계: 요약 + 대시보드 미리보기 + (필요하면) 덮어쓰기 확인 */
export function ReviewStep({ draft, errors, onChange, needsOverwrite, writable, message }: ReviewProps) {
  const [now] = useState(() => new Date());
  const state = useMemo(() => toPreviewState(draft, now), [draft, now]);
  const region = draft.regionMode === "list" ? findRegion(draft.regionKey)?.label : draft.manual.label.trim();
  const birthdays = birthdayAnniversaries(draft.members);
  const extras = extraAnniversaries(draft);
  // extras는 draft.anniversaries 중 날짜가 유효한 것만 같은 순서로 뽑은 것이라 draft key와 짝이 맞는다
  const extraKeys = draft.anniversaries.filter((a) => validMonthDay(a.month, a.day)).map((a) => a.key);
  const md = (monthDay: string) => `${Number(monthDay.slice(0, 2))}월 ${Number(monthDay.slice(3))}일`;

  return (
    <>
      {message && (
        <p role="alert" className={s.summary}>
          {message}
        </p>
      )}
      {errors.form && (
        <p role="alert" className={s.summary}>
          {errors.form}
        </p>
      )}
      {!writable && <p className={s.note}>서버에 위키 경로(WIKI_REPO_PATH)가 설정되지 않아 지금은 저장할 수 없어요. 노트북의 .env를 확인해 주세요.</p>}

      <section className={s.body} aria-labelledby="sum-title">
        <h2 id="sum-title" className={s.sectionTitle}>
          입력한 내용
        </h2>
        <dl className={s.dl}>
          <dt>가족 이름</dt>
          <dd>{draft.familyName.trim()}</dd>
          <dt>지역</dt>
          <dd>{region}</dd>
          <dt>시간대</dt>
          <dd>{draft.timezone.trim()}</dd>
          <dt>구글 캘린더</dt>
          <dd>{draft.calendarId.trim() || "연결 안 함"}</dd>
          <dt>슬랙</dt>
          <dd>앱 준비 후 연결</dd>
        </dl>
        <ul className={s.list} aria-label="구성원">
          {draft.members.map((m, i) => (
            <li key={m.key} className={s.item}>
              <span className={s.dot} style={{ background: colorOf(m.color) }} aria-hidden="true" />
              <span className={s.itemMain}>
                <span>{memberLabel(m, i)}</span>
                <span className={s.itemSub}>
                  {m.role === "guardian" ? "보호자" : "아이"} · {isPickableColor(m.color) ? COLOR_LABELS[m.color] : m.color}
                  {m.birth ? ` · 생일 ${m.birth}` : ""} · id {m.id}
                </span>
              </span>
            </li>
          ))}
          <li className={s.item}>
            <span className={s.dot} style={{ background: colorOf("gray") }} aria-hidden="true" />
            <span className={s.itemMain}>
              <span>가족 전체</span>
              <span className={s.itemSub}>기본 · id family</span>
            </span>
          </li>
        </ul>
        <p>
          기념일 {birthdays.length + extras.length}건
          {birthdays.length + extras.length > 0 && ` (생일 ${birthdays.length}건 + 추가 ${extras.length}건)`}
        </p>
        {extras.length > 0 && (
          <ul className={s.list} aria-label="추가한 기념일">
            {extras.map((a, i) => (
              <li key={extraKeys[i]} className={s.item}>
                {md(a.monthDay)} · {a.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.body} aria-labelledby="preview-title">
        <h2 id="preview-title" className={s.sectionTitle}>
          태블릿 미리보기
        </h2>
        <DashboardPreview state={state} />
        <p className={s.itemSub}>날씨는 예시예요. 일정·할 일은 슬랙에서 말하면 채워져요.</p>
      </section>

      {needsOverwrite && (
        <label className={s.check}>
          <input type="checkbox" id="f-overwrite" checked={draft.overwrite} onChange={(e) => onChange({ ...draft, overwrite: e.target.checked })} aria-invalid={errors.overwrite ? true : undefined} aria-describedby="overwrite-note" />
          <span>
            이전에 남은 세팅 파일(구성원·기념일)을 지우고 위 내용으로 덮어써요.
            <span id="overwrite-note" className={s.itemSub} style={{ display: "block" }}>
              {errors.overwrite ?? "위키 기록(git)에는 이전 내용이 남아 있어서 되돌릴 수 있어요."}
            </span>
          </span>
        </label>
      )}
    </>
  );
}
