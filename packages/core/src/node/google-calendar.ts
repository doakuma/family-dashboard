// 구글 캘린더 어댑터(CalendarSync 구현, Node 전용). 서비스 계정 JWT(RS256) -> 토큰 교환 -> Calendar API v3.
// fetch·now·sleep은 주입한다(키·계정·네트워크 없이 목으로 시험). 결정 0012.
// 오류·로그에 서비스 계정 키·토큰·캘린더 id·URL을 싣지 않는다: 메시지는 고정 문구 + 상태 코드 + 영문자 이유 코드뿐이고, 원래 오류(cause)는 붙이지 않는다.
import { createHash, createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CalendarSyncError, toGoogleEvent, type CalendarRuntime, type CalendarErrorKind } from "../calendar";
import type { CalendarSync } from "../ports";
import type { Event, FamilyId } from "../types";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
/** 일정 만들기·고치기·지우기만(캘린더 목록·설정은 못 건드림) */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_TIMEOUT_MS = 10_000;

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

const B32HEX = "0123456789abcdefghijklmnopqrstuv";
/**
 * 구글 이벤트 id(클라이언트 지정): 가족 id + 위키 일정 id의 sha256 앞 20바이트를 base32hex(소문자 0-9a-v)로 32자.
 * 구글 규칙(5~1024자, a-v와 0-9)에 맞고, 같은 일정은 항상 같은 id라 기록을 잃어도 중복되지 않는다.
 */
export function googleEventId(familyId: FamilyId, wikiId: string, gen = 0): string {
  // 세대 0은 접미사 없음(기존 id와 같음). 지운 id를 되살리지 못할 때만 세대를 올려 새 id를 만든다
  const bytes = createHash("sha256").update(`${familyId}\n${wikiId}${gen ? `\n${gen}` : ""}`).digest().subarray(0, 20);
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32HEX[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

const keyFileSchema = z.object({ client_email: z.string().email().max(254), private_key: z.string().min(1).max(10_000) });
export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: KeyObject;
}

/** 서비스 계정 JSON을 읽는다. 오류 문구에는 파일 내용을 싣지 않는다(경로만) */
export async function loadServiceAccountKey(path: string): Promise<ServiceAccountKey> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new CalendarSyncError("config", `서비스 계정 파일을 읽지 못했어요(GOOGLE_SERVICE_ACCOUNT_JSON: ${path})`);
  }
  return parseServiceAccountKey(text);
}

export function parseServiceAccountKey(text: string): ServiceAccountKey {
  const bad = () => new CalendarSyncError("config", "서비스 계정 파일 형식이 올바르지 않아요(client_email·private_key가 든 JSON이어야 해요)");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw bad();
  }
  const parsed = keyFileSchema.safeParse(json);
  if (!parsed.success) throw bad();
  try {
    return { clientEmail: parsed.data.client_email, privateKey: createPrivateKey(parsed.data.private_key) };
  } catch {
    throw bad();
  }
}

/** fetch의 좁힌 모양(전역 fetch가 그대로 들어간다) */
export type GoogleFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; text(): Promise<string> }>;

export interface GoogleCalendarOptions {
  key: ServiceAccountKey;
  familyId: FamilyId;
  /** 캘린더 id와 본문 문맥(시간대·구성원 이름). reconciler가 매 실행 처음에 채운다 */
  runtime: CalendarRuntime;
  fetch: GoogleFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** 요청당 제한 시간. 기본 10초 */
  timeoutMs?: number;
  /** 다시 시도 가능한 오류의 최대 시도 수. 기본 3 */
  maxAttempts?: number;
  /** 첫 재시도 대기(ms), 두 배씩. 기본 500 */
  baseDelayMs?: number;
}

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() });
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"]);
const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");
/** 토큰 만료 직전 여유 */
const TOKEN_MARGIN_MS = 60_000;
const MAX_RETRY_AFTER_MS = 30_000;

export class GoogleCalendarSync implements CalendarSync {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private token: { value: string; expiresAt: number } | undefined;
  private tokenPending: Promise<string> | undefined;

  constructor(private readonly o: GoogleCalendarOptions) {
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** 새로 만들거나(없으면) 고친다. 구글에서 지워진 일정이면 다시 만든다 */
  async upsert(e: Event): Promise<void> {
    const gid = this.gid(e.id);
    const body = { ...toGoogleEvent(e, this.o.runtime.context), id: gid };
    const item = `/events/${gid}`;
    try {
      await this.call("PUT", item, body);
      return;
    } catch (err) {
      if (!(err instanceof CalendarSyncError) || err.kind !== "not_found") throw err;
    }
    try {
      await this.call("POST", "/events", body);
    } catch (err) {
      if (err instanceof CalendarSyncError && err.kind === "not_found") throw this.calendarMissing(err);
      // 이미 있다(지웠다 취소 상태로 남은 같은 id이거나 동시에 만들어짐): 고치기로 되살린다
      if (!(err instanceof CalendarSyncError) || err.kind !== "conflict") throw err;
      try {
        await this.call("PUT", item, body);
      } catch (err2) {
        // 되살리지도 못한다: 호출한 쪽이 세대를 올려 새 id로 다시 시도한다
        if (err2 instanceof CalendarSyncError && err2.kind === "not_found") throw new CalendarSyncError("conflict", "지운 같은 일정 id를 되살리지 못했어요", err2.status, err2.reason);
        throw err2;
      }
    }
  }

  /** 캘린더에 접근할 수 있는지(events.list 한 건). 404는 "캘린더 없음/공유 안 됨"이므로 forbidden으로 바꿔 던진다 */
  async checkAccess(): Promise<void> {
    try {
      await this.call("GET", "/events?maxResults=1");
    } catch (err) {
      if (err instanceof CalendarSyncError && err.kind === "not_found") throw this.calendarMissing(err);
      throw err;
    }
  }

  private calendarMissing(e: CalendarSyncError): CalendarSyncError {
    return new CalendarSyncError("forbidden", "캘린더를 찾지 못했어요(캘린더 id가 맞는지, 서비스 계정 이메일에 '일정 변경' 권한으로 공유했는지 확인해 주세요)", e.status, e.reason);
  }

  private gid(wikiId: string): string {
    return googleEventId(this.o.familyId, wikiId, this.o.runtime.generations?.[wikiId] ?? 0);
  }

  /** 위키 일정 id로 지운다. 이미 없으면(404·410) 성공으로 본다 */
  async remove(id: string): Promise<void> {
    try {
      await this.call("DELETE", `/events/${this.gid(id)}`);
    } catch (err) {
      if (err instanceof CalendarSyncError && err.kind === "not_found") return;
      throw err;
    }
  }

  // --- 요청 ---

  private calendarPath(): string {
    const id = this.o.runtime.calendarId;
    if (!id) throw new CalendarSyncError("config", "캘린더 id가 정해지지 않았어요");
    return `/calendars/${encodeURIComponent(id)}`;
  }

  /** 다시 시도할 수 있는 오류는 지수 백오프로 (최대 maxAttempts번) */
  private async call(method: string, path: string, body?: unknown): Promise<void> {
    const max = this.o.maxAttempts ?? 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.callOnce(method, path, body);
        return;
      } catch (err) {
        if (!(err instanceof CalendarSyncError) || !err.retryable || attempt >= max) throw err;
        const wait = Math.min(err.retryAfterMs ?? (this.o.baseDelayMs ?? 500) * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS);
        await this.sleep(wait);
      }
    }
  }

  private async callOnce(method: string, path: string, body?: unknown): Promise<void> {
    // 401이면 토큰을 버리고 한 번만 새로 받아 다시(만료·취소)
    for (let pass = 0; ; pass++) {
      const token = await this.accessToken();
      const res = await this.send(`${GOOGLE_API_BASE}${this.calendarPath()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.ok) return;
      if (res.status === 401 && pass === 0) {
        this.token = undefined;
        continue;
      }
      throw classify(res.status, res.text, res.retryAfterMs);
    }
  }

  /** fetch + 제한 시간 + 본문 읽기. 오류는 종류만 남기고 원래 메시지는 버린다 */
  private async send(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; text: string; retryAfterMs?: number }> {
    const signal = AbortSignal.timeout(this.o.timeoutMs ?? GOOGLE_TIMEOUT_MS);
    try {
      const res = await this.o.fetch(url, { ...init, signal });
      const text = await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, text, retryAfterMs: parseRetryAfter(res.headers?.get("retry-after") ?? null) };
    } catch (e) {
      const timedOut = signal.aborted || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
      throw timedOut
        ? new CalendarSyncError("timeout", `구글 응답이 ${Math.round((this.o.timeoutMs ?? GOOGLE_TIMEOUT_MS) / 1000)}초 안에 오지 않았어요(시간 초과)`)
        : new CalendarSyncError("network", "구글에 연결하지 못했어요(네트워크)");
    }
  }

  // --- 토큰 ---

  private accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return Promise.resolve(this.token.value);
    // 동시에 여러 요청이 와도 토큰 교환은 한 번
    this.tokenPending ??= this.fetchToken().finally(() => {
      this.tokenPending = undefined;
    });
    return this.tokenPending;
  }

  private jwt(): string {
    const iat = Math.floor(this.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: this.o.key.clientEmail, scope: GOOGLE_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }));
    let sig: Buffer;
    try {
      sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(this.o.key.privateKey);
    } catch {
      throw new CalendarSyncError("config", "서비스 계정 키로 서명하지 못했어요(키 형식을 확인해 주세요)");
    }
    return `${head}.${claims}.${b64url(sig)}`;
  }

  private async fetchToken(): Promise<string> {
    const form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: this.jwt() });
    const res = await this.send(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    if (!res.ok) {
      // 토큰 교환의 4xx(invalid_grant·invalid_client 등)는 키 문제, 5xx·한도는 일시적
      if (res.status >= 500 || res.status === 429) throw classify(res.status, res.text, res.retryAfterMs);
      throw new CalendarSyncError("auth", "구글 인증에 실패했어요(서비스 계정 키를 확인해 주세요)", res.status, tokenReason(res.text));
    }
    let parsed: z.ZodSafeParseResult<z.infer<typeof tokenSchema>>;
    try {
      parsed = tokenSchema.safeParse(JSON.parse(res.text));
    } catch {
      parsed = tokenSchema.safeParse(undefined);
    }
    if (!parsed.success) throw new CalendarSyncError("auth", "구글 인증 응답을 읽지 못했어요", res.status);
    const ttl = (parsed.data.expires_in ?? 3600) * 1000;
    this.token = { value: parsed.data.access_token, expiresAt: this.now() + Math.max(0, ttl - TOKEN_MARGIN_MS) };
    return parsed.data.access_token;
  }
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v || !/^\d{1,5}$/.test(v.trim())) return undefined;
  return Number(v) * 1000;
}

const safeReason = (v: unknown): string | undefined => (typeof v === "string" && /^[A-Za-z_]{1,40}$/.test(v) ? v : undefined);

function tokenReason(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { error?: unknown };
    return safeReason(j.error);
  } catch {
    return undefined;
  }
}

/** Calendar API 오류 본문에서 이유 코드(영문자)만 꺼낸다. 메시지 문장은 쓰지 않는다(캘린더 id가 들어 있을 수 있음) */
function apiReason(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { error?: { errors?: { reason?: unknown }[]; status?: unknown } };
    return safeReason(j.error?.errors?.[0]?.reason) ?? safeReason(j.error?.status);
  } catch {
    return undefined;
  }
}

function classify(status: number, text: string, retryAfterMs?: number): CalendarSyncError {
  const reason = apiReason(text);
  const make = (kind: CalendarErrorKind, msg: string) => new CalendarSyncError(kind, `${msg} (HTTP ${status}${reason ? `, ${reason}` : ""})`, status, reason, retryAfterMs);
  if (status === 401) return make("auth", "구글 인증에 실패했어요(서비스 계정 키를 확인해 주세요)");
  if (status === 429 || (status === 403 && reason && RATE_REASONS.has(reason))) return make("rate_limit", "구글 요청 한도에 걸렸어요");
  if (status === 403) return make("forbidden", "이 캘린더에 쓸 권한이 없어요(서비스 계정 이메일에 '일정 변경' 권한으로 공유했는지 확인해 주세요)");
  if (status === 404 || status === 410) return make("not_found", "구글에서 대상을 찾지 못했어요(캘린더 id 또는 일정)");
  if (status === 409) return make("conflict", "같은 일정 id가 이미 있어요");
  if (status >= 500) return make("server", "구글 서버 오류예요");
  return make("http", "구글이 요청을 받아들이지 않았어요");
}
