// 구글 캘린더 API의 가짜 서버(시험 전용, 실제 네트워크 없음). GoogleCalendarSync의 fetch 자리에 넣는다.
// 실제 구글의 동작 중 이 어댑터가 기대는 것만 흉내 낸다: 토큰 교환(JWT 서명 검증), 이벤트 PUT(없으면 404, 취소 상태면 되살림)·POST(있으면 409)·DELETE(없으면 404, 지운 것은 cancelled로 남음).
import { createVerify, type KeyObject } from "node:crypto";
import type { GoogleFetch } from "./google-calendar";

export interface MockCall {
  method: string;
  /** 쿼리 없는 경로(토큰 교환은 /token) */
  path: string;
  body?: unknown;
  authorization?: string;
}
export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
/** 요청마다 불리는 결함 주입. 응답을 돌려주면 그것을 쓰고, "throw"면 네트워크 오류, "hang"이면 제한 시간까지 멈춤, undefined면 정상 처리 */
export type MockFault = (call: MockCall, n: number) => MockReply | "throw" | "hang" | undefined;

export interface MockGoogle {
  fetch: GoogleFetch;
  calls: MockCall[];
  /** `${calendarId}/${eventId}` -> 저장된 이벤트(status 포함) */
  events: Map<string, Record<string, unknown>>;
  tokensIssued: () => number;
  /** 지금 유효한 토큰을 모두 무효로(401 시험) */
  revokeTokens: () => void;
  setFault: (f: MockFault | undefined) => void;
  /** 취소되지 않은 이벤트 수 */
  liveCount: () => number;
}

export function createMockGoogle(opts: { publicKey?: KeyObject; expiresIn?: number } = {}): MockGoogle {
  const calls: MockCall[] = [];
  const events = new Map<string, Record<string, unknown>>();
  let valid = new Set<string>();
  let issued = 0;
  let fault: MockFault | undefined;
  let n = 0;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  });
  const apiError = (status: number, reason: string) => json(status, { error: { code: status, message: "mock", errors: [{ reason }] } });

  const fetch: GoogleFetch = async (url, init) => {
    const u = new URL(url);
    const isToken = u.host === "oauth2.googleapis.com";
    const path = isToken ? "/token" : decodeURIComponent(u.pathname.replace("/calendar/v3", ""));
    const call: MockCall = { method: init.method, path, authorization: init.headers.Authorization };
    if (init.body && !isToken) call.body = JSON.parse(init.body);
    if (init.body && isToken) call.body = Object.fromEntries(new URLSearchParams(init.body));
    calls.push(call);

    const f = fault?.(call, n++);
    if (f === "throw") throw new TypeError(`fetch failed ${url}`); // 실제 오류 메시지에는 URL이 섞일 수 있다
    if (f === "hang") {
      await new Promise<never>((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
      });
    }
    if (f && f !== "hang") return json(f.status, f.body, f.headers);

    if (isToken) {
      const form = call.body as Record<string, string>;
      if (form.grant_type !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || !form.assertion) return json(400, { error: "invalid_request" });
      const [h, c, s] = form.assertion.split(".");
      if (opts.publicKey) {
        const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(opts.publicKey, Buffer.from(s ?? "", "base64url"));
        if (!ok) return json(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
      }
      const token = `mock-token-${++issued}`;
      valid.add(token);
      return json(200, { access_token: token, expires_in: opts.expiresIn ?? 3600, token_type: "Bearer" });
    }

    const token = (init.headers.Authorization ?? "").replace(/^Bearer /, "");
    if (!valid.has(token)) return apiError(401, "authError");
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (!m) return apiError(404, "notFound");
    const [, cal, id] = m;
    const bodyId = (call.body as { id?: string } | undefined)?.id;
    const key = (eid: string) => `${cal}/${eid}`;

    if (init.method === "POST" && !id) {
      if (!bodyId) return apiError(400, "invalid");
      if (events.has(key(bodyId))) return apiError(409, "duplicate");
      events.set(key(bodyId), { ...(call.body as object), status: "confirmed" });
      return json(200, events.get(key(bodyId)));
    }
    if (init.method === "PUT" && id) {
      if (!events.has(key(id))) return apiError(404, "notFound");
      events.set(key(id), { ...(call.body as object), status: "confirmed" });
      return json(200, events.get(key(id)));
    }
    if (init.method === "DELETE" && id) {
      const cur = events.get(key(id));
      if (!cur) return apiError(404, "notFound");
      if (cur.status === "cancelled") return apiError(410, "deleted");
      events.set(key(id), { ...cur, status: "cancelled" });
      return json(204, undefined);
    }
    return apiError(400, "invalid");
  };

  return {
    fetch,
    calls,
    events,
    tokensIssued: () => issued,
    revokeTokens: () => {
      valid = new Set();
    },
    setFault: (f) => {
      fault = f;
    },
    liveCount: () => [...events.values()].filter((e) => e.status !== "cancelled").length,
  };
}
