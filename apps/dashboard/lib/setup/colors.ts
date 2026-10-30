// 구성원 색 고르기. 위키에는 색 이름만 저장하고(MEMBER_COLORS의 키), 화면 색은 palette가 정한다.
import type { MemberColorName } from "../palette";

/** 자동 추천 순서. gray는 '가족 전체' 색이라 구성원 후보에서 뺀다. */
export const PICKABLE_COLORS = ["coral", "teal", "blue", "amber", "green", "purple", "pink"] as const satisfies readonly MemberColorName[];

export const COLOR_LABELS: Record<(typeof PICKABLE_COLORS)[number], string> = {
  coral: "산호",
  teal: "청록",
  blue: "파랑",
  amber: "호박",
  green: "초록",
  purple: "보라",
  pink: "분홍",
};

export const isPickableColor = (c: string): c is (typeof PICKABLE_COLORS)[number] => (PICKABLE_COLORS as readonly string[]).includes(c);

/** 이미 쓰는 색과 겹치지 않는 첫 색. 모두 쓰였으면 가장 적게 쓰인 색(동률이면 순서가 앞선 색) */
export function suggestColor(used: readonly string[]): string {
  const count = (c: string) => used.filter((u) => u === c).length;
  let best: string = PICKABLE_COLORS[0];
  for (const c of PICKABLE_COLORS) {
    if (count(c) === 0) return c;
    if (count(c) < count(best)) best = c;
  }
  return best;
}
