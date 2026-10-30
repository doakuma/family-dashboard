// 좌우 스와이프 판정. DOM 없이 테스트하려고 순수 함수로 둔다.

export interface SwipeConfig {
  /** 가로로 이만큼(px) 넘게 움직여야 스와이프 */
  minDistance: number;
  /** 가로 이동이 세로 이동의 이 배수보다 커야 한다(비스듬한 손짓·세로 스크롤을 거른다) */
  dominance: number;
  /** 이 시간(ms)보다 오래 끌면 스와이프가 아니다(천천히 끄는 건 의도가 불분명) */
  maxDurationMs: number;
}

export const SWIPE_DEFAULTS: SwipeConfig = { minDistance: 60, dominance: 1.5, maxDurationMs: 800 };

/** 'next' = 왼쪽으로 밀기(다음 달), 'prev' = 오른쪽으로 밀기(이전 달). 아니면 undefined */
export function swipeDirection(dx: number, dy: number, durationMs: number, cfg: SwipeConfig = SWIPE_DEFAULTS): "next" | "prev" | undefined {
  if (durationMs > cfg.maxDurationMs) return undefined;
  if (Math.abs(dx) < cfg.minDistance) return undefined;
  if (Math.abs(dx) < Math.abs(dy) * cfg.dominance) return undefined;
  return dx < 0 ? "next" : "prev";
}
