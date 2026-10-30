import type { Lockout } from "./lockout";
import { verifyPin } from "./pin";

export type PinCheck = { status: "ok" } | { status: "wrong" } | { status: "unconfigured" } | { status: "locked"; retryAfterMs: number };

/**
 * 잠금 확인 -> 해시 비교 -> 결과에 따라 실패 횟수 갱신.
 * 잠겨 있으면 맞는 PIN이어도 거부한다. 형식이 틀린 입력도 실패 1회로 센다.
 * ADMIN_PIN_HASH가 없으면 아무도 못 들어간다(기본 PIN 없음).
 */
export function checkPin(deps: { lockout: Lockout; storedHash: string | undefined }, pin: string): PinCheck {
  const lock = deps.lockout.check();
  if (lock.locked) return { status: "locked", retryAfterMs: lock.retryAfterMs };
  if (!deps.storedHash?.trim()) return { status: "unconfigured" };
  if (verifyPin(pin, deps.storedHash)) {
    deps.lockout.success();
    return { status: "ok" };
  }
  deps.lockout.fail();
  const after = deps.lockout.check();
  return after.locked ? { status: "locked", retryAfterMs: after.retryAfterMs } : { status: "wrong" };
}
