// 관리자 PIN 해시. node:crypto만 쓴다(서버와 scripts/pin-hash.ts가 같이 쓴다).
// 형식: scrypt:N:r:p:salt:hash  (base64url). `$`를 쓰지 않는 이유: Next가 .env를 읽을 때 `$이름`을 변수로 치환한다.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;
const SALT_BYTES = 16;
const DEFAULT = { N: 16384, r: 8, p: 1 } as const;
// .env가 망가졌을 때 메모리를 폭주시키는 값을 막는다
const MAX_N = 1 << 17;

/** 4~6자리 숫자 */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function hashPin(pin: string): string {
  if (!isValidPinFormat(pin)) throw new Error("PIN은 숫자 4~6자리여야 해요");
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = DEFAULT;
  const hash = scryptSync(pin, salt, KEYLEN, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

/** 저장된 값이 없거나 형식이 틀리면 false (예외를 던지지 않는다) */
export function verifyPin(pin: string, stored: string | undefined): boolean {
  if (!stored || !isValidPinFormat(pin)) return false;
  const parts = stored.trim().split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (salt.length < 8 || expected.length !== KEYLEN) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(pin, salt, expected.length, { N, r, p, maxmem: 256 * N * r });
  } catch {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
