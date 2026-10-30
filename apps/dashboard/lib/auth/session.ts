// 세팅/설정 세션 쿠키. HMAC 서명 + 만료. 비밀키는 프로세스 메모리에만 있어 서버를 다시 켜면 모든 세션이 끝난다.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "hsh_session";
export const SESSION_TTL_MS = 30 * 60_000;

/** setup: QR 토큰 + PIN으로 들어옴(/setup 가능). pin: PIN만으로 들어옴(/settings만). */
export type SessionVia = "setup" | "pin";
export interface Session {
  via: SessionVia;
  /** epoch ms */
  exp: number;
}

export interface SessionCodec {
  sign(via: SessionVia): string;
  verify(value: string | undefined): Session | undefined;
}

export function createSessionCodec(opts: { secret?: Buffer; ttlMs?: number; now?: () => number } = {}): SessionCodec {
  const secret = opts.secret ?? randomBytes(32);
  const ttl = opts.ttlMs ?? SESSION_TTL_MS;
  const now = opts.now ?? Date.now;
  const mac = (payload: string) => createHmac("sha256", secret).update(payload).digest();

  return {
    sign(via) {
      const payload = Buffer.from(JSON.stringify({ via, exp: now() + ttl } satisfies Session)).toString("base64url");
      return `${payload}.${mac(payload).toString("base64url")}`;
    },
    verify(value) {
      if (!value) return undefined;
      const [payload, sig, extra] = value.split(".");
      if (!payload || !sig || extra !== undefined) return undefined;
      const given = Buffer.from(sig, "base64url");
      const want = mac(payload);
      if (given.length !== want.length || !timingSafeEqual(given, want)) return undefined;
      try {
        const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Session>;
        if ((s.via !== "setup" && s.via !== "pin") || typeof s.exp !== "number" || s.exp <= now()) return undefined;
        return { via: s.via, exp: s.exp };
      } catch {
        return undefined;
      }
    },
  };
}

/** 쿠키 속성: HttpOnly, SameSite=Strict. Secure는 집 안 http라 붙이지 않는다(결정 기록 0002). */
export function sessionCookieOptions(ttlMs: number = SESSION_TTL_MS) {
  return { httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: Math.floor(ttlMs / 1000) };
}
