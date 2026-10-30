"use client";
import { Button } from "@/components/ui/form/Button";
import { TextField } from "@/components/ui/form/Field";
import { fieldId } from "@/lib/setup/validate";
import s from "../setup.module.css";
import type { StepProps } from "./types";

/** 5단계(선택): 구글 캘린더. ID 형식만 확인하고, 연결 테스트는 #11 이후. */
export function CalendarStep({ draft, errors, onChange }: StepProps) {
  return (
    <>
      <p className={s.note}>
        위키가 원본이고, 구글 캘린더는 알림을 받기 위한 복사본이에요. 쓰지 않으면 건너뛰어도 되고, 나중에 설정에서 넣을 수 있어요.
      </p>
      <TextField
        id={fieldId("calendarId")}
        label="구글 캘린더 ID"
        value={draft.calendarId}
        onChange={(calendarId) => onChange({ ...draft, calendarId })}
        error={errors.calendarId}
        optional
        type="email"
        inputMode="email"
        placeholder="abc123@group.calendar.google.com"
        hint="구글 캘린더 설정 > 캘린더 통합 > 캘린더 ID에 있어요. 메일 주소 모양이에요."
        maxLength={254}
        enterKeyHint="next"
      />
      <div className={s.body}>
        <Button variant="secondary" disabled aria-describedby="cal-test-note">
          연결 테스트
        </Button>
        <p id="cal-test-note" className={s.itemSub}>
          연결 테스트는 구글 캘린더 연동(#11)이 준비된 뒤에 쓸 수 있어요. 지금은 ID 형식만 확인해요.
        </p>
      </div>
    </>
  );
}
