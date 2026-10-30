// 자동 순환 스크롤의 판단 로직. DOM 없이 테스트할 수 있게 순수 함수로 둔다.
// 흐름: 맨 위에서 잠깐 멈춤 -> 천천히 아래로 -> 맨 아래에서 잠깐 멈춤 -> 처음으로 -> 반복.

export interface AutoScrollConfig {
  /** 내려가는 속도 (px/초). 읽을 수 있을 만큼 느리게 */
  speed: number;
  /** 맨 위·맨 아래에서 멈춰 있는 시간 (ms) */
  holdMs: number;
  /** 손으로 만진 뒤 자동 순환을 다시 시작하기까지 (ms). 스펙의 '마지막 터치 후 자동 복귀' 120초와 맞춘다 */
  resumeAfterTouchMs: number;
}

export const AUTO_SCROLL_DEFAULTS: AutoScrollConfig = { speed: 22, holdMs: 3500, resumeAfterTouchMs: 120_000 };

/** 내용이 영역보다 길 때만 순환한다. 1px 이하 차이는 반올림 오차로 본다. */
export function overflows(m: { clientHeight: number; scrollHeight: number }): boolean {
  return m.scrollHeight - m.clientHeight > 1;
}

export function maxScroll(m: { clientHeight: number; scrollHeight: number }): number {
  return Math.max(0, m.scrollHeight - m.clientHeight);
}

export interface RunInput {
  overflows: boolean;
  reducedMotion: boolean;
  /** 지금 손가락이 닿아 있거나 휠을 쓰는 중 */
  touching: boolean;
  /** 마지막으로 만진 시각(ms). 만진 적 없으면 undefined */
  lastTouchAt?: number;
  now: number;
  resumeAfterTouchMs: number;
}

/** 지금 자동으로 움직여도 되는가 */
export function shouldAutoScroll(i: RunInput): boolean {
  if (!i.overflows || i.reducedMotion || i.touching) return false;
  return i.lastTouchAt === undefined || i.now - i.lastTouchAt >= i.resumeAfterTouchMs;
}

export type Phase = "hold-top" | "down" | "hold-bottom";
export interface CycleState {
  phase: Phase;
  /** 현재 단계에 머문 시간 (ms) */
  elapsed: number;
  /** 스크롤 위치(px, 소수 유지: 느린 속도에서 브라우저 반올림으로 멈추지 않게) */
  pos: number;
}

export const initialCycle = (pos = 0): CycleState => ({ phase: pos > 0 ? "down" : "hold-top", elapsed: 0, pos });

/** dtMs만큼 시간이 흐른 뒤의 상태. max는 스크롤 가능한 최대 위치 */
export function stepCycle(state: CycleState, dtMs: number, max: number, cfg: AutoScrollConfig = AUTO_SCROLL_DEFAULTS): CycleState {
  if (max <= 0) return initialCycle();
  const s = { ...state, pos: Math.min(Math.max(0, state.pos), max) };
  switch (s.phase) {
    case "hold-top": {
      const elapsed = s.elapsed + dtMs;
      return elapsed >= cfg.holdMs ? { phase: "down", elapsed: 0, pos: s.pos } : { ...s, elapsed };
    }
    case "down": {
      const pos = s.pos + (cfg.speed * dtMs) / 1000;
      return pos >= max ? { phase: "hold-bottom", elapsed: 0, pos: max } : { ...s, pos, elapsed: s.elapsed + dtMs };
    }
    case "hold-bottom": {
      const elapsed = s.elapsed + dtMs;
      return elapsed >= cfg.holdMs ? { phase: "hold-top", elapsed: 0, pos: 0 } : { ...s, elapsed };
    }
  }
}
