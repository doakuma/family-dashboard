"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/form/Button";
import { Field, FieldGroup, SelectField, TextField } from "@/components/ui/form/Field";
import { birthdayAnniversaries } from "@/lib/setup/build";
import { addAnniversary, removeAnniversary, updateAnniversary } from "@/lib/setup/draft";
import { fieldId, memberLabel } from "@/lib/setup/validate";
import s from "../setup.module.css";
import f from "@/components/ui/form/form.module.css";
import type { StepProps } from "./types";

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const ADD_ID = "anniv-add";
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

/** 4단계: 기념일. 구성원 생일은 자동으로 들어가고(미리보기), 결혼기념일 등은 직접 추가한다. */
export function AnniversaryStep({ draft, errors, onChange }: StepProps) {
  const birthdays = birthdayAnniversaries(draft.members);
  const focusNew = useRef<string | undefined>(undefined);

  useEffect(() => {
    const k = focusNew.current;
    if (!k) return;
    focusNew.current = undefined;
    // "add"는 마지막 기념일을 지워 이웃이 없을 때: 눌렀던 버튼이 사라졌으니 추가 버튼으로
    document.getElementById(k === "add" ? ADD_ID : fieldId(`anniv.${k}.title`))?.focus();
  }, [draft.anniversaries.length]);

  const remove = (key: string) => {
    const i = draft.anniversaries.findIndex((a) => a.key === key);
    focusNew.current = (draft.anniversaries[i + 1] ?? draft.anniversaries[i - 1])?.key ?? "add";
    onChange(removeAnniversary(draft, key));
  };

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
          return (
            <fieldset key={a.key} className={s.card}>
              <legend>{`기념일 ${i + 1}`}</legend>
              <TextField id={fieldId(`${k}.title`)} label="제목" value={a.title} onChange={(title) => onChange(updateAnniversary(draft, a.key, { title }))} error={errors[`${k}.title`]} hint="예: 결혼기념일" maxLength={100} enterKeyHint="next" />
              <FieldGroup id={fieldId(`${k}.date`)} error={dateError} className={s.row2}>
                {(aria) => (
                  <>
                    <Field id={fieldId(`${k}.date`)} label="월">
                      {(c) => (
                        <select {...c} {...aria} className={f.select} value={a.month} onChange={(e) => onChange(updateAnniversary(draft, a.key, { month: e.target.value }))}>
                          <option value="">월</option>
                          {MONTHS.map((m) => (
                            <option key={m} value={m}>
                              {m}월
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field id={`${fieldId(`${k}.date`)}-day`} label="일">
                      {(c) => (
                        <select {...c} {...aria} className={f.select} value={a.day} onChange={(e) => onChange(updateAnniversary(draft, a.key, { day: e.target.value }))}>
                          <option value="">일</option>
                          {DAYS.map((d) => (
                            <option key={d} value={d}>
                              {d}일
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </>
                )}
              </FieldGroup>
              <SelectField id={fieldId(`${k}.member`)} label="누구의 기념일인가요" value={a.member} onChange={(member) => onChange(updateAnniversary(draft, a.key, { member }))} error={errors[`${k}.member`]}>
                <option value="family">가족 전체</option>
                {draft.members.map((m, mi) => (
                  <option key={m.key} value={m.id}>
                    {memberLabel(m, mi)}
                  </option>
                ))}
              </SelectField>
              <Button variant="quiet" aria-label={`기념일 ${i + 1} 삭제`} onClick={() => remove(a.key)}>
                이 기념일 삭제
              </Button>
            </fieldset>
          );
        })}
        <Button id={ADD_ID} variant="secondary" onClick={() => add()}>
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
