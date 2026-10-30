// 일회용 세팅 토큰 (메모리). 태블릿 QR에 담긴다. 서버를 다시 켜면 사라진다.
import { createHash, randomBytes } from "node:crypto";

export interface SetupTokenStore {
  /** 쓸 수 있는 토큰을 돌려준다. 없거나 곧 만료되면 새로 만든다(이미 나간 토큰은 자기 만료까지 유효). */
  current(): string;
  /** 유효한지만 본다(소모하지 않음) */
  isValid(token: string | undefined): boolean;
  /** 유효하면 모든 토큰을 폐기하고 true. 쓰면 끝, 다음 current()가 새로 발급한다. */
  consume(token: string | undefined): boolean;
  /** 세팅이 끝났을 때: 남은 토큰을 모두 폐기한다(태블릿이 중간에 새로 받은 토큰 포함) */
  revokeAll(): void;
}

const digest = (t: string) => createHash("sha256").update(t).digest("hex");

export function createSetupTokenStore(opts: { ttlMs?: number; refreshMarginMs?: number; now?: () => number } = {}): SetupTokenStore {
  const ttl = opts.ttlMs ?? 30 * 60_000;
  const margin = opts.refreshMarginMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  // sha256(토큰) -> 만료 시각. 토큰 원문은 저장하지 않는다.
  const live = new Map<string, number>();
  let latest: { token: string; expires: number } | undefined;

  const prune = () => {
    for (const [k, exp] of live) if (exp <= now()) live.delete(k);
  };

  return {
    current() {
      prune();
      if (latest && latest.expires - now() > margin && live.has(digest(latest.token))) return latest.token;
      const token = randomBytes(32).toString("base64url");
      latest = { token, expires: now() + ttl };
      live.set(digest(token), latest.expires);
      return token;
    },
    isValid(token) {
      if (!token) return false;
      prune();
      return live.has(digest(token));
    },
    consume(token) {
      if (!this.isValid(token)) return false;
      live.clear();
      latest = undefined;
      return true;
    },
    revokeAll() {
      live.clear();
      latest = undefined;
    },
  };
}
