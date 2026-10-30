// PIN 시도 제한 (메모리). 가족 내부망이라 접속자 구분 없이 하나로 센다.
export interface Lockout {
  /** 잠겨 있으면 남은 시간(ms) */
  check(): { locked: false } | { locked: true; retryAfterMs: number };
  fail(): void;
  success(): void;
}

export function createLockout(opts: { maxFailures?: number; lockMs?: number; now?: () => number } = {}): Lockout {
  const max = opts.maxFailures ?? 5;
  const lockMs = opts.lockMs ?? 15 * 60_000;
  const now = opts.now ?? Date.now;
  let failures = 0;
  let lockedUntil = 0;

  const check: Lockout["check"] = () => {
    if (lockedUntil > now()) return { locked: true, retryAfterMs: lockedUntil - now() };
    if (lockedUntil) {
      // 잠금이 끝났으면 처음부터 다시 센다
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
      if (failures >= max) lockedUntil = now() + lockMs;
    },
    success() {
      failures = 0;
      lockedUntil = 0;
    },
  };
}
