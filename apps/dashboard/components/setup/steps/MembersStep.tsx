"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/form/Button";
import { Disclosure } from "@/components/ui/form/Disclosure";
import { ChoiceGroup, SwatchGroup, TextField } from "@/components/ui/form/Field";
import { MEMBER_COLORS, colorOf } from "@/lib/palette";
import { COLOR_LABELS, PICKABLE_COLORS } from "@/lib/setup/colors";
import { MAX_MEMBERS, addMember, removeMember, updateMember, type MemberDraft } from "@/lib/setup/draft";
import { fieldId, memberLabel } from "@/lib/setup/validate";
import s from "../setup.module.css";
import type { StepProps } from "./types";

const ROLE_OPTIONS = [
  { value: "guardian" as const, label: "보호자" },
  { value: "child" as const, label: "아이" },
];
const COLOR_OPTIONS = PICKABLE_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c], css: MEMBER_COLORS[c] }));

/** 2단계: 구성원 추가. '가족 전체'(@family)는 기본으로 있고 지울 수 없다. */
export function MembersStep({ draft, errors, onChange }: StepProps) {
  // 오늘 이후 생일은 고를 수 없게(검증도 같은 기준). 마운트 후 값이라 서버 HTML과 어긋나지 않는다(이 단계는 클라이언트에서만 그려진다).
  const [today] = useState(() => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()));
  const focusNew = useRef<string | undefined>(undefined);

  // 구성원을 추가하면 새 카드의 이름 칸으로 포커스
  useEffect(() => {
    if (!focusNew.current) return;
    document.getElementById(fieldId(`member.${focusNew.current}.name`))?.focus();
    focusNew.current = undefined;
  }, [draft.members.length]);

  const add = () => {
    const next = addMember(draft);
    focusNew.current = next.members.at(-1)?.key;
    onChange(next);
  };
  // 삭제하면 이웃 카드(없으면 앞 카드)의 이름 칸으로 포커스: 눌렀던 버튼이 사라져 포커스가 문서 처음으로 튀지 않게
  const remove = (key: string) => {
    const i = draft.members.findIndex((m) => m.key === key);
    const neighbor = draft.members[i + 1] ?? draft.members[i - 1];
    focusNew.current = neighbor?.key;
    onChange(removeMember(draft, key));
  };
  const patch = (key: string, p: Partial<Omit<MemberDraft, "key" | "idEdited">>) => onChange(updateMember(draft, key, p));

  return (
    <>
      {errors.members && (
        <p id={fieldId("members")} className={s.summary} data-invalid="true" tabIndex={-1}>
          {errors.members}
        </p>
      )}
      {draft.members.map((m, i) => {
        const k = `member.${m.key}`;
        const label = memberLabel(m, i);
        return (
          <fieldset key={m.key} className={s.card}>
            <legend>{`구성원 ${i + 1}${m.name.trim() ? ` · ${m.name.trim()}` : ""}`}</legend>
            <TextField id={fieldId(`${k}.name`)} label="이름" value={m.name} onChange={(name) => patch(m.key, { name })} error={errors[`${k}.name`]} maxLength={60} enterKeyHint="next" />
            <ChoiceGroup id={fieldId(`${k}.role`)} legend="역할" value={m.role} options={ROLE_OPTIONS} onChange={(role) => patch(m.key, { role })} hint={m.role === "guardian" ? "슬랙에서 일정·할 일을 쓸 수 있어요" : "슬랙에서 물어보기만 할 수 있어요"} />
            <TextField id={fieldId(`${k}.birth`)} label="생일" type="date" value={m.birth} onChange={(birth) => patch(m.key, { birth })} error={errors[`${k}.birth`]} optional max={today} min="1900-01-01" hint="입력하면 생일이 기념일에 자동으로 들어가요" />
            <SwatchGroup id={fieldId(`${k}.color`)} legend="색" value={m.color} options={COLOR_OPTIONS} onChange={(color) => patch(m.key, { color })} error={errors[`${k}.color`]} hint="일정 옆의 점 색이에요. 다른 사람과 겹치지 않게 골라 뒀어요" />
            <Disclosure className={s.details} forceOpen={Boolean(errors[`${k}.id`])} summary={`위키 id: ${m.id || "(없음)"} (바꾸려면 누르세요)`}>
              <TextField
                id={fieldId(`${k}.id`)}
                label="id"
                value={m.id}
                onChange={(id) => patch(m.key, { id })}
                error={errors[`${k}.id`]}
                hint="영문·숫자·-·_ 만 쓸 수 있어요. 위키 파일 이름과 일정의 @표시에 쓰여요. 한글 이름이면 member-1처럼 자동으로 정해요."
                maxLength={40}
              />
            </Disclosure>
            {draft.members.length > 1 && (
              <Button variant="quiet" aria-label={`${label} 삭제`} onClick={() => remove(m.key)}>
                이 구성원 삭제
              </Button>
            )}
          </fieldset>
        );
      })}

      <div className={s.cardFixed}>
        <span className={s.dot} style={{ background: colorOf("gray") }} aria-hidden="true" />
        <span>가족 전체 (@family)</span>
        <span className={s.badge}>기본 · 삭제할 수 없어요</span>
      </div>

      <Button variant="secondary" onClick={add} disabled={draft.members.length >= MAX_MEMBERS}>
        구성원 추가 ({draft.members.length}/{MAX_MEMBERS})
      </Button>
    </>
  );
}
