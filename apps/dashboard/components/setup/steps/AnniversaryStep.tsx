"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/form/Button";
import { SelectField, TextField } from "@/components/ui/form/Field";
import { birthdayAnniversaries } from "@/lib/setup/build";
import { addAnniversary, removeAnniversary, updateAnniversary } from "@/lib/setup/draft";
import { fieldId, memberLabel } from "@/lib/setup/validate";
import s from "../setup.module.css";
import f from "@/components/ui/form/form.module.css";
import type { StepProps } from "./types";

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

/** 4단계: 기념일. 구성원 생일은 자동으로 들어가고(미리보기), 결혼기념일 등은 직접 추가한다. */
export function AnniversaryStep({ draft, errors, onChange }: StepProps) {
  const birthdays = birthdayAnniversaries(draft.members);
  const focusNew = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!focusNew.current) return;
    document.getElementById(fieldId(`anniv.${focusNew.current}.title`))?.focus();
    focusNew.current = undefined;
  }, [draft.anniversaries.length]);

  const add = (init: { title?: string } = {}) => {
    const next = addAnniversary(draft, init);
    focusNew.current = next.anniversaries.at(-1)?.key;
    onChange(next);
  };

  return (
    <>
      <section className={s.body} aria-labelledby="birthdays-title">
        <h2 id="birthdays-title" className={s.sectionTitle}>
          생일 (자동 등록)
        </h2>
        {birthdays.length === 0 ? (
          <p className={s.note}>생일을 입력한 구성원이 없어요. 2단계에서 생일을 넣으면 여기에 자동으로 들어가요.</p>
        ) : (
          <ul className={s.list}>
            {birthdays.map((b) => (
              <li key={`${b.monthDay}-${b.member}`} className={s.item}>
                <span className={s.itemMain}>
                  <span>{b.title}</span>
                  <span className={s.itemSub}>매년 {Number(b.monthDay.slice(0, 2))}월 {Number(b.monthDay.slice(3))}일</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.body} aria-labelledby="extra-title">
        <h2 id="extra-title" className={s.sectionTitle}>
          그 밖의 기념일
        </h2>
        {draft.anniversaries.map((a, i) => {
          const k = `anniv.${a.key}`;
          const dateError = errors[`${k}.date`];
          const dateHint = `${fieldId(`${k}.date`)}-error`;
          return (
            <fieldset key={a.key} className={s.card}>
              <legend>{`기념일 ${i + 1}`}</legend>
              <TextField id={fieldId(`${k}.title`)} label="제목" value={a.title} onChange={(title) => onChange(updateAnniversary(draft, a.key, { title }))} error={errors[`${k}.title`]} hint="예: 결혼기념일" maxLength={100} enterKeyHint="next" />
              <div className={s.row2}>
                <div className={f.field}>
                  <label htmlFor={fieldId(`${k}.date`)} className={f.label}>
                    월
                  </label>
                  <select id={fieldId(`${k}.date`)} className={f.select} value={a.month} onChange={(e) => onChange(updateAnniversary(draft, a.key, { month: e.target.value }))} aria-invalid={dateError ? true : undefined} aria-describedby={dateError ? dateHint : undefined}>
                    <option value="">월</option>
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {m}월
                      </option>
                    ))}
                  </select>
                </div>
                <div className={f.field}>
                  <label htmlFor={`${fieldId(`${k}.date`)}-day`} className={f.label}>
                    일
                  </label>
                  <select id={`${fieldId(`${k}.date`)}-day`} className={f.select} value={a.day} onChange={(e) => onChange(updateAnniversary(draft, a.key, { day: e.target.value }))} aria-invalid={dateError ? true : undefined} aria-describedby={dateError ? dateHint : undefined}>
                    <option value="">일</option>
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}일
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {dateError && (
                <p id={dateHint} className={f.error}>
                  {dateError}
                </p>
              )}
              <SelectField id={fieldId(`${k}.member`)} label="누구의 기념일인가요" value={a.member} onChange={(member) => onChange(updateAnniversary(draft, a.key, { member }))} error={errors[`${k}.member`]}>
                <option value="family">가족 전체</option>
                {draft.members.map((m, mi) => (
                  <option key={m.key} value={m.id}>
                    {memberLabel(m, mi)}
                  </option>
                ))}
              </SelectField>
              <Button variant="quiet" aria-label={`기념일 ${i + 1} 삭제`} onClick={() => onChange(removeAnniversary(draft, a.key))}>
                이 기념일 삭제
              </Button>
            </fieldset>
          );
        })}
        <Button variant="secondary" onClick={() => add()}>
          기념일 추가
        </Button>
        {!draft.anniversaries.some((a) => a.title.trim() === "결혼기념일") && (
          <Button variant="quiet" onClick={() => add({ title: "결혼기념일" })}>
            결혼기념일 추가
          </Button>
        )}
      </section>
    </>
  );
}
