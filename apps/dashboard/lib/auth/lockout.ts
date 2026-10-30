// PIN 시도 제한 (메모리). 가족 내부망이라 접속자 구분 없이 하나로 센다.
// 연속으로 잠길수록 잠금 시간이 2배로 늘고(15분 -> 30분 -> 60분 ...), 상한(기본 24시간)이 있다. PIN이 맞으면 모두 초기화.
export interface Lockout {
  /** 잠겨 있으면 남은 시간(ms) */
  check(): { locked: false } | { locked: true; retryAfterMs: number };
  fail(): void;
  success(): void;
}

export function createLockout(opts: { maxFailures?: number; lockMs?: number; maxLockMs?: number; now?: () => number } = {}): Lockout {
  const max = opts.maxFailures ?? 5;
  const baseMs = opts.lockMs ?? 15 * 60_000;
  const capMs = opts.maxLockMs ?? 24 * 60 * 60_000;
  const now = opts.now ?? Date.now;
  let failures = 0;
  let lockedUntil = 0;
  /** 지금까지 연이어 잠긴 횟수(성공할 때까지 유지) */
  let lockouts = 0;

  const check: Lockout["check"] = () => {
    if (lockedUntil > now()) return { locked: true, retryAfterMs: lockedUntil - now() };
    if (lockedUntil) {
      // 잠금이 끝났으면 실패 횟수만 다시 센다(잠금 단계는 성공할 때까지 유지)
      lockedUntil = 0;
      failures = 0;
    }
    return { locked: false };
  };

  return {
    check,
    fail() {
      if (check().locked) return;
      failures += 1;
      if (failures >= max) {
        lockedUntil = now() + Math.min(baseMs * 2 ** lockouts, capMs);
        lockouts += 1;
      }
    },
    success() {
      failures = 0;
      lockedUntil = 0;
      lockouts = 0;
    },
  };
}
