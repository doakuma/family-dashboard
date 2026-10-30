// 구성원 색 이름(위키에 저장되는 값) → 화면 색. 위키에는 이름만 저장하고, 실제 색값은 스킨의 색 슬롯(--member-<name>)이 정한다.
// 그래서 스킨을 바꾸거나 어두운 톤이 되어도 데이터는 그대로다.
import { MEMBER_COLOR_SLOTS, type MemberColorSlot } from "../skins/contract";

export type MemberColorName = MemberColorSlot;

export const isMemberColorName = (n: string): n is MemberColorName => (MEMBER_COLOR_SLOTS as readonly string[]).includes(n);

const slot = (n: MemberColorName) => `var(--member-${n})`;

/** 이름 -> CSS 색 값(`var(--member-<name>)`). 이름 대신 #hex가 들어 있으면 그대로(스킨을 따르지 않음), 그 밖은 gray 슬롯. */
export function colorOf(name?: string): string {
  if (name && isMemberColorName(name)) return slot(name);
  if (name && /^#[0-9a-f]{3,8}$/i.test(name)) return name;
  return slot("gray");
}

/** 이름별 CSS 색 값 (색 고르기 견본용) */
export const MEMBER_COLORS = {
  coral: slot("coral"),
  teal: slot("teal"),
  blue: slot("blue"),
  amber: slot("amber"),
  green: slot("green"),
  purple: slot("purple"),
  pink: slot("pink"),
  gray: slot("gray"),
} as const satisfies Record<MemberColorName, string>;
