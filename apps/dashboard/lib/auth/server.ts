// 서버 전용 인증 상태. 토큰·잠금·세션 비밀키는 프로세스 메모리에만 있다(파일에 쓰지 않는다).
// Next가 페이지/라우트를 따로 번들해도 같은 인스턴스를 쓰도록 globalThis에 둔다.
import "server-only";
import { cookies } from "next/headers";
import { config, netConfig } from "../config";
import { isAllowedOrigin } from "./host";
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
  return checkPin({ lockout: authState().lockout, storedHash: config.get("adminPinHash") }, pin);
}

export async function readSession(): Promise<Session | undefined> {
  return authState().codec.verify((await cookies()).get(SESSION_COOKIE)?.value);
}

/** 폼 POST의 출처 확인: Origin(없으면 Referer)이 DASHBOARD_BASE_URL의 origin과 같아야 한다(Host 헤더는 보지 않음). SameSite=Strict와 함께 쓰는 이중 장치. */
export function isSameOrigin(req: Request): boolean {
  return isAllowedOrigin(req.headers.get("origin") ?? req.headers.get("referer"), netConfig());
}

/** 잠겨 있으면 남은 시간(ms), 아니면 undefined (화면 안내용) */
export function lockRemainingMs(): number | undefined {
  const c = authState().lockout.check();
  return c.locked ? c.retryAfterMs : undefined;
}

export function retryMinutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}
