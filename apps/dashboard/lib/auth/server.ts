// 서버 전용 인증 상태. 토큰·잠금·세션 비밀키는 프로세스 메모리에만 있다(파일에 쓰지 않는다).
// Next가 페이지/라우트를 따로 번들해도 같은 인스턴스를 쓰도록 globalThis에 둔다.
import "server-only";
import { cookies } from "next/headers";
import { createLockout, type Lockout } from "./lockout";
import { checkPin, type PinCheck } from "./pin-check";
import { createSessionCodec, SESSION_COOKIE, type Session, type SessionCodec } from "./session";
import { createSetupTokenStore, type SetupTokenStore } from "./setup-token";

interface AuthState {
  lockout: Lockout;
  tokens: SetupTokenStore;
  codec: SessionCodec;
}
const KEY = Symbol.for("hsh.auth.v1");
type G = typeof globalThis & { [KEY]?: AuthState };

export function authState(): AuthState {
  const g = globalThis as G;
  return (g[KEY] ??= { lockout: createLockout(), tokens: createSetupTokenStore(), codec: createSessionCodec() });
}

export function verifyAdminPin(pin: string): PinCheck {
  return checkPin({ lockout: authState().lockout, storedHash: process.env.ADMIN_PIN_HASH }, pin);
}

export async function readSession(): Promise<Session | undefined> {
  return authState().codec.verify((await cookies()).get(SESSION_COOKIE)?.value);
}

/** 폼 POST의 출처 확인: Origin(없으면 Referer)의 host가 요청 Host와 같아야 한다. SameSite=Strict와 함께 쓰는 이중 장치. */
export function isSameOrigin(req: Request): boolean {
  const from = req.headers.get("origin") ?? req.headers.get("referer");
  const host = req.headers.get("host");
  if (!from || !host) return false;
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}

export function retryMinutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}
