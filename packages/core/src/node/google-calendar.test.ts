import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CalendarSyncError, type CalendarRuntime } from "../calendar";
import { DEFAULT_FAMILY_ID, type Event } from "../types";
import { GOOGLE_SCOPE, GoogleCalendarSync, googleEventId, loadServiceAccountKey, parseServiceAccountKey, type GoogleCalendarOptions } from "./google-calendar";
import { createMockGoogle, type MockGoogle } from "./google-mock";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const EMAIL = "hsh-bot@my-project.iam.gserviceaccount.com";
const CAL = "family123456@group.calendar.google.com";
const keyJson = JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: PEM, private_key_id: "abc" });

const ev = (o: Partial<Event> = {}): Event => ({ id: "evt-a1", date: "2026-11-12", start: "15:00", end: "16:00", allDay: false, title: "치과 검진", members: ["haneul"], done: false, ...o });

describe("googleEventId", () => {
  it("구글 규칙(5~1024자, 0-9a-v)에 맞고, 같은 입력은 같고 가족·일정이 다르면 다르다", () => {
    const id = googleEventId(DEFAULT_FAMILY_ID, "evt-a1");
    expect(id).toMatch(/^[0-9a-v]{32}$/);
    expect(googleEventId(DEFAULT_FAMILY_ID, "evt-a1")).toBe(id);
    expect(googleEventId(DEFAULT_FAMILY_ID, "evt-a2")).not.toBe(id);
    expect(googleEventId("other" as typeof DEFAULT_FAMILY_ID, "evt-a1")).not.toBe(id);
  });
});

describe("서비스 계정 키 읽기", () => {
  it("올바른 JSON이면 읽고, 형식이 틀리면 내용 없이 config 오류", async () => {
    expect(parseServiceAccountKey(keyJson).clientEmail).toBe(EMAIL);
    for (const bad of ["not json", "{}", JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" }), JSON.stringify({ client_email: "x", private_key: PEM })]) {
      let err: unknown;
      try { parseServiceAccountKey(bad); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(CalendarSyncError);
      expect((err as CalendarSyncError).kind).toBe("config");
      expect((err as Error).message).not.toContain("AAAA");
      expect((err as Error).message).not.toContain(EMAIL);
    }
    const dir = mkdtempSync(join(tmpdir(), "hsh-gkey-"));
    writeFileSync(join(dir, "k.json"), keyJson);
    expect((await loadServiceAccountKey(join(dir, "k.json"))).clientEmail).toBe(EMAIL);
    await expect(loadServiceAccountKey(join(dir, "none.json"))).rejects.toMatchObject({ kind: "config" });
  });
});

describe("GoogleCalendarSync (목 fetch)", () => {
  let g: MockGoogle;
  let clock: number;
  let sleeps: number[];
  const runtime = (): CalendarRuntime => ({ calendarId: CAL, context: { timezone: "Asia/Seoul", names: { haneul: "하늘" } } });
  const make = (o: Partial<GoogleCalendarOptions> = {}) =>
    new GoogleCalendarSync({
      key: parseServiceAccountKey(keyJson),
      familyId: DEFAULT_FAMILY_ID,
      runtime: runtime(),
      fetch: g.fetch,
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); },
      ...o,
    });
  const gid = googleEventId(DEFAULT_FAMILY_ID, "evt-a1");
  const stored = () => g.events.get(`${CAL}/${gid}`);

  beforeEach(() => {
    g = createMockGoogle({ publicKey });
    clock = Date.parse("2026-11-10T03:00:00Z");
    sleeps = [];
  });

  it("만들기: JWT(RS256·scope·aud)로 토큰을 받고 PUT(404) -> POST로 만든다. 본문에 위키 id·시간대", async () => {
    await make().upsert(ev());
    const token = g.calls[0]!;
    expect(token.path).toBe("/token");
    const [h, c, s] = (token.body as { assertion: string }).assertion.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
    expect(claims).toMatchObject({ iss: EMAIL, scope: GOOGLE_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: clock / 1000, exp: clock / 1000 + 3600 });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);

    expect(g.calls.slice(1).map((x) => `${x.method} ${x.path}`)).toEqual([`PUT /calendars/${CAL}/events/${gid}`, `POST /calendars/${CAL}/events`]);
    expect(stored()).toMatchObject({
      id: gid,
      summary: "치과 검진",
      start: { dateTime: "2026-11-12T15:00:00", timeZone: "Asia/Seoul" },
      end: { dateTime: "2026-11-12T16:00:00", timeZone: "Asia/Seoul" },
      extendedProperties: { private: { hshId: "evt-a1" } },
    });
    expect(String(stored()!.description)).toContain("담당: 하늘");
  });

  it("수정: 이미 있으면 PUT 한 번으로 덮는다(중복 없음)", async () => {
    const s = make();
    await s.upsert(ev());
    g.calls.length = 0;
    await s.upsert(ev({ title: "바뀐 제목" }));
    expect(g.calls.map((x) => x.method)).toEqual(["PUT"]);
    expect(g.liveCount()).toBe(1);
    expect(stored()!.summary).toBe("바뀐 제목");
  });

  it("삭제: DELETE, 이미 없으면(404) 지워진 것(410)도 성공", async () => {
    const s = make();
    await s.upsert(ev());
    await s.remove("evt-a1");
    expect(stored()!.status).toBe("cancelled");
    await expect(s.remove("evt-a1")).resolves.toBeUndefined(); // 410
    await expect(s.remove("evt-none")).resolves.toBeUndefined(); // 404
  });

  it("지운 뒤 같은 일정을 다시 올리면 되살린다(PUT)", async () => {
    const s = make();
    await s.upsert(ev());
    await s.remove("evt-a1");
    await s.upsert(ev());
    expect(stored()!.status).toBe("confirmed");
    expect(g.liveCount()).toBe(1);
  });

  it("구글에서 사람이 지운 복사본(없음)을 수정하려 하면 새로 만든다", async () => {
    const s = make();
    await s.upsert(ev());
    g.events.delete(`${CAL}/${gid}`);
    await s.upsert(ev({ title: "다시" }));
    expect(stored()!.summary).toBe("다시");
  });

  it("만들기 경합(PUT 404 뒤 다른 쪽이 먼저 만들어 POST 409)이면 PUT으로 고친다", async () => {
    const s = make();
    g.setFault((call) => {
      if (call.method === "PUT" && !g.events.has(`${CAL}/${gid}`)) {
        g.events.set(`${CAL}/${gid}`, { id: gid, status: "confirmed" }); // 그 사이에 다른 실행이 만듦
        return { status: 404, body: { error: { errors: [{ reason: "notFound" }] } } };
      }
      return undefined;
    });
    await s.upsert(ev());
    expect(stored()!.summary).toBe("치과 검진");
    expect(g.calls.filter((c) => c.path !== "/token").map((c) => c.method)).toEqual(["PUT", "POST", "PUT"]);
  });

  it("토큰은 캐시하고, 만료 1분 전에 새로 받는다. 동시 요청도 토큰 교환은 한 번", async () => {
    const s = make();
    await Promise.all([s.upsert(ev({ id: "evt-1" })), s.upsert(ev({ id: "evt-2" })), s.upsert(ev({ id: "evt-3" }))]);
    expect(g.tokensIssued()).toBe(1);
    await s.upsert(ev({ id: "evt-4" }));
    expect(g.tokensIssued()).toBe(1);
    clock += 3600_000 - 61_000; // 만료 61초 전: 아직 유효
    await s.upsert(ev({ id: "evt-5" }));
    expect(g.tokensIssued()).toBe(1);
    clock += 2_000; // 59초 전: 새로 받음
    await s.upsert(ev({ id: "evt-6" }));
    expect(g.tokensIssued()).toBe(2);
    expect(g.calls.filter((c) => c.authorization === "Bearer mock-token-2")).not.toHaveLength(0);
  });

  it("서버가 토큰을 취소하면(401) 한 번 새로 받아 다시 한다", async () => {
    const s = make();
    await s.upsert(ev());
    g.revokeTokens();
    await s.upsert(ev({ title: "또" }));
    expect(g.tokensIssued()).toBe(2);
    expect(stored()!.summary).toBe("또");
  });

  it("계속 401이면 auth 오류(무한 반복 없음)", async () => {
    const s = make();
    g.setFault((call) => (call.path !== "/token" ? { status: 401, body: { error: { errors: [{ reason: "authError" }] } } } : undefined));
    await expect(s.upsert(ev())).rejects.toMatchObject({ kind: "auth", status: 401 });
    expect(g.tokensIssued()).toBe(2);
  });

  describe("오류 분류", () => {
    const reply = (status: number, reason?: string, headers?: Record<string, string>) =>
      g.setFault((call) => (call.path !== "/token" ? { status, headers, body: { error: { code: status, message: `Not Found: ${CAL}`, errors: reason ? [{ reason }] : [] } } } : undefined));
    const kindOf = async (op: () => Promise<void>) => {
      try { await op(); } catch (e) { return e as CalendarSyncError; }
      throw new Error("오류가 나야 해요");
    };

    it("토큰 교환 실패(invalid_grant)는 auth", async () => {
      g.setFault((call) => (call.path === "/token" ? { status: 400, body: { error: "invalid_grant", error_description: `Invalid JWT for ${EMAIL}` } } : undefined));
      const e = await kindOf(() => make().upsert(ev()));
      expect(e).toMatchObject({ kind: "auth", reason: "invalid_grant" });
      expect(e.message).not.toContain(EMAIL);
    });

    it("키가 틀리면(서명 불일치) auth", async () => {
      const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const s = make({ key: parseServiceAccountKey(JSON.stringify({ client_email: EMAIL, private_key: other })) });
      expect((await kindOf(() => s.upsert(ev()))).kind).toBe("auth");
    });

    it("403 권한 없음은 forbidden(재시도 안 함), 403 한도·429는 rate_limit(재시도)", async () => {
      reply(403, "forbidden");
      const f = await kindOf(() => make().upsert(ev()));
      expect(f).toMatchObject({ kind: "forbidden", retryable: false });
      expect(sleeps).toEqual([]);

      for (const [st, reason] of [[403, "rateLimitExceeded"], [403, "userRateLimitExceeded"], [429, undefined]] as const) {
        sleeps = [];
        reply(st, reason);
        const e = await kindOf(() => make().upsert(ev()));
        expect(e.kind, `${st} ${reason}`).toBe("rate_limit");
        expect(sleeps).toEqual([500, 1000]); // 3번 시도, 지수 백오프
      }
    });

    it("Retry-After를 따른다(상한 30초)", async () => {
      reply(429, undefined, { "retry-after": "2" });
      await kindOf(() => make().upsert(ev()));
      expect(sleeps).toEqual([2000, 2000]);
      sleeps = [];
      reply(429, undefined, { "retry-after": "9999" });
      await kindOf(() => make().upsert(ev()));
      expect(sleeps).toEqual([30000, 30000]);
    });

    it("5xx는 server로 3번 시도 뒤 실패, 중간에 성공하면 성공", async () => {
      reply(503);
      expect((await kindOf(() => make().upsert(ev()))).kind).toBe("server");
      expect(g.calls.filter((c) => c.method === "PUT")).toHaveLength(3);

      g.calls.length = 0;
      g.setFault((call, n) => (call.path !== "/token" && n < 3 ? { status: 500 } : undefined));
      await make().upsert(ev());
      expect(stored()).toBeDefined();
    });

    it("400은 http(재시도 안 함), 404 캘린더 없음은 upsert에서 POST도 404면 not_found", async () => {
      reply(400, "invalid");
      expect(await kindOf(() => make().upsert(ev()))).toMatchObject({ kind: "http", retryable: false });
      reply(404, "notFound");
      expect((await kindOf(() => make().upsert(ev()))).kind).toBe("not_found");
    });

    it("네트워크 오류는 network로 재시도하고 URL·캘린더 id를 오류에 싣지 않는다", async () => {
      g.setFault(() => "throw");
      sleeps = [];
      const e = await kindOf(() => make().upsert(ev()));
      expect(e.kind).toBe("network");
      expect(e.cause).toBeUndefined();
      expect(sleeps).toHaveLength(2);
      expect(e.message).not.toMatch(/https?:|googleapis/);
    });

    it("제한 시간 안에 응답이 없으면 timeout(재시도 뒤 실패)", async () => {
      g.setFault(() => "hang");
      const e = await kindOf(() => make({ timeoutMs: 20, maxAttempts: 2 }).upsert(ev()));
      expect(e.kind).toBe("timeout");
      expect(e.message).toContain("시간 초과");
      expect(g.calls).toHaveLength(2);
    });

    it("캘린더 id가 없으면 config 오류(요청 없음)", async () => {
      const s = make({ runtime: { context: { timezone: "Asia/Seoul", names: {} } } });
      // 토큰은 받지만 캘린더 호출 전에 거부
      expect((await kindOf(() => s.upsert(ev()))).kind).toBe("config");
      expect(g.calls.filter((c) => c.path !== "/token")).toHaveLength(0);
    });
  });

  it("키·토큰·서비스 계정 이메일·캘린더 id가 오류 메시지·로그 어디에도 없다", async () => {
    const secrets = [PEM, "BEGIN PRIVATE KEY", EMAIL, CAL, "mock-token", "abc", encodeURIComponent(CAL)];
    const seen: string[] = [];
    const run = async (fault: Parameters<MockGoogle["setFault"]>[0], op: (s: GoogleCalendarSync) => Promise<void>) => {
      g = createMockGoogle({ publicKey });
      g.setFault(fault);
      try { await op(make({ timeoutMs: 20, maxAttempts: 1 })); } catch (e) {
        const err = e as Error;
        seen.push(String(err.message), String(err.stack ?? ""), JSON.stringify(err), String(err.cause ?? ""));
      }
    };
    const body = (st: number) => ({ status: st, body: { error: { message: `calendar ${CAL} token mock-token ${EMAIL}`, errors: [{ reason: "someReason", message: CAL }] } } });
    for (const st of [400, 401, 403, 404, 409, 429, 500]) await run((c) => (c.path !== "/token" ? body(st) : undefined), (s) => s.upsert(ev()));
    await run((c) => (c.path === "/token" ? { status: 400, body: { error: "invalid_grant", error_description: EMAIL } } : undefined), (s) => s.upsert(ev()));
    await run(() => "throw", (s) => s.upsert(ev()));
    await run(() => "hang", (s) => s.remove("evt-a1"));
    expect(seen.length).toBeGreaterThan(8);
    for (const text of seen) for (const secret of secrets) expect(text).not.toContain(secret);
  });

  it("이유 코드는 영문자일 때만 오류에 붙는다(이상한 값은 버림)", async () => {
    g.setFault((c) => (c.path !== "/token" ? { status: 400, body: { error: { errors: [{ reason: `bad ${CAL}!` }] } } } : undefined));
    try { await make().upsert(ev()); } catch (e) {
      expect((e as CalendarSyncError).reason).toBeUndefined();
      expect((e as Error).message).not.toContain(CAL);
    }
  });
});
