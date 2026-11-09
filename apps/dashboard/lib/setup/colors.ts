// 구성원 색 고르기. 위키에는 색 이름만 저장하고(MEMBER_COLORS의 키), 화면 색은 palette가 정한다.
import { PICKABLE_COLORS } from "@hsh/core";

export { COLOR_LABELS, PICKABLE_COLORS, isPickableColor } from "@hsh/core";

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
