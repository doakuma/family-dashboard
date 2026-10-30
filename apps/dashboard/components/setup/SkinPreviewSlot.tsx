import type { ReactNode } from "react";
import s from "./setup.module.css";

/**
 * 1단계 "스킨·캐릭터 미리보기"(#30)가 들어올 자리. 지금은 children이 없어서 아무것도 그리지 않는다.
 * #30에서 이 자리에 미리보기 컴포넌트를 넣는다(HomeStep의 위치·props는 바꾸지 않는다).
 */
export function SkinPreviewSlot({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className={s.slot}>{children}</div>;
}
