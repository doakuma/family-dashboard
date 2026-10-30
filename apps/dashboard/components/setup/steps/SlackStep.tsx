"use client";
import { colorOf } from "@/lib/palette";
import { memberLabel } from "@/lib/setup/validate";
import { ConnectCodeSlot } from "../ConnectCodeSlot";
import s from "../setup.module.css";
import type { StepProps } from "./types";

/** 3단계: 슬랙 연결. 코드 발급·검증은 #19 - 여기는 자리와 안내만 있다. */
export function SlackStep({ draft }: StepProps) {
  return (
    <>
      <p className={s.note}>
        슬랙 앱이 준비되면 구성원마다 6자리 연결 코드를 받아 슬랙 DM으로 보내면 연결돼요. 지금은 건너뛰어도 괜찮아요. 나중에 설정에서 연결할 수 있어요.
      </p>
      <ul className={s.list} aria-label="구성원별 연결 코드">
        {draft.members.map((m, i) => (
          <li key={m.key} className={s.item}>
            <span className={s.dot} style={{ background: colorOf(m.color) }} aria-hidden="true" />
            <span className={s.itemMain}>
              <span>{memberLabel(m, i)}</span>
              <span className={s.itemSub}>{m.role === "guardian" ? "보호자" : "아이"} · 슬랙 앱 준비 후 연결</span>
            </span>
            <ConnectCodeSlot />
          </li>
        ))}
      </ul>
    </>
  );
}
