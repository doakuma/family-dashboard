import { describe, expect, it, vi } from "vitest";
import { APP_ERROR, FIXTURE_NOW, KEY_ERROR_XML, MID_LAND_OK, MID_TA_OK, NO_DATA, SHORT_OK } from "./__fixtures__/kma-fixtures";
import { KmaError } from "./kma";
import { KMA_ENDPOINTS, KmaWeatherSource, cachedByRegion, type KmaFetch, type KmaRegion } from "./kma-source";

const KEY = "SECRET+key/with=chars==";
const SEOUL: KmaRegion = { nx: 60, ny: 127, midLandRegId: "11B00000", midTaRegId: "11B10101" };
const BUSAN: KmaRegion = { nx: 98, ny: 76, midLandRegId: "11H20000", midTaRegId: "11H20201" };

type Reply = string | { status: number; body: string } | Error;
/** URL 접두에 따라 답하는 fetch 목. 호출 URL을 기록한다. */
function mockFetch(replies: { short?: Reply; land?: Reply; ta?: Reply }) {
  const calls: string[] = [];
  const f: KmaFetch = async (url) => {
    calls.push(url);
    const r = url.startsWith(KMA_ENDPOINTS.short) ? replies.short : url.startsWith(KMA_ENDPOINTS.midLand) ? replies.land : replies.ta;
    if (r instanceof Error) throw r;
    const x = typeof r === "string" || r === undefined ? { status: 200, body: r ?? "" } : r;
    return { ok: x.status >= 200 && x.status < 300, status: x.status, text: async () => x.body };
  };
  return { f, calls };
}
const ok = { short: SHORT_OK, land: MID_LAND_OK, ta: MID_TA_OK };
const make = (m: ReturnType<typeof mockFetch>, region: () => KmaRegion | undefined = () => SEOUL, warn = vi.fn()) =>
  new KmaWeatherSource({ serviceKey: KEY, fetch: m.f, now: () => FIXTURE_NOW, region, warn });

describe("KmaWeatherSource", () => {
  it("단기 1회 + 중기 2회, 올바른 파라미터, 7일 반환", async () => {
    const m = mockFetch(ok);
    const days = await make(m).week();
    expect(days).toHaveLength(7);
    expect(m.calls).toHaveLength(3);
    const q = (i: number) => new URL(m.calls[i] ?? "").searchParams;
    const short = m.calls.findIndex((u) => u.startsWith(KMA_ENDPOINTS.short));
    expect(Object.fromEntries(q(short))).toMatchObject({ serviceKey: KEY, dataType: "JSON", base_date: "20261109", base_time: "0500", nx: "60", ny: "127", numOfRows: "1500" });
    const land = m.calls.findIndex((u) => u.startsWith(KMA_ENDPOINTS.midLand));
    expect(Object.fromEntries(q(land))).toMatchObject({ regId: "11B00000", tmFc: "202611081800", dataType: "JSON" });
    const ta = m.calls.findIndex((u) => u.startsWith(KMA_ENDPOINTS.midTa));
    expect(q(ta).get("regId")).toBe("11B10101");
  });

  it("인증키는 URL 인코딩되어 전달된다 (+ / = 포함)", async () => {
    const m = mockFetch(ok);
    await make(m).week();
    expect(m.calls[0]).toContain("serviceKey=SECRET%2Bkey%2Fwith%3Dchars%3D%3D");
  });

  it("중기가 실패해도 단기만으로 반환(부분 성공), 경고를 남김", async () => {
    const warn = vi.fn();
    const days = await make(mockFetch({ short: SHORT_OK, land: { status: 500, body: "" }, ta: MID_TA_OK }), () => SEOUL, warn).week();
    expect(days.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(warn).toHaveBeenCalled();
  });

  it("단기가 실패하면 중기만 (오늘~+2는 없음)", async () => {
    const days = await make(mockFetch({ short: NO_DATA, land: MID_LAND_OK, ta: MID_TA_OK })).week();
    expect(days[0]?.date).toBe("2026-11-11");
  });

  it("둘 다 실패하면 던진다", async () => {
    await expect(make(mockFetch({ short: APP_ERROR, land: NO_DATA, ta: NO_DATA })).week()).rejects.toBeInstanceOf(KmaError);
  });

  it("NO_DATA면 직전 발표로 한 번 더 시도한다", async () => {
    const urls: string[] = [];
    const f: KmaFetch = async (url) => {
      urls.push(url);
      const first = new URL(url).searchParams.get("base_time") === "0500" || new URL(url).searchParams.get("tmFc") === "202611081800";
      const body = first ? NO_DATA : url.startsWith(KMA_ENDPOINTS.short) ? SHORT_OK : url.startsWith(KMA_ENDPOINTS.midLand) ? MID_LAND_OK : MID_TA_OK;
      return { ok: true, status: 200, text: async () => body };
    };
    const days = await new KmaWeatherSource({ serviceKey: KEY, fetch: f, now: () => FIXTURE_NOW, region: () => SEOUL, warn: () => {} }).week();
    expect(days.length).toBeGreaterThan(3);
    const prev = urls.map((u) => new URL(u).searchParams);
    expect(prev.some((p) => p.get("base_time") === "0200")).toBe(true);
    expect(prev.some((p) => p.get("tmFc") === "202611080600")).toBe(true);
  });

  it("지역이 없으면 no_region", async () => {
    await expect(make(mockFetch(ok), () => undefined).week()).rejects.toMatchObject({ kind: "no_region" });
  });

  it("오류 메시지·경고에 인증키가 섞이지 않는다 (키 오류 XML, HTTP 오류, 네트워크 오류, 시간 초과)", async () => {
    const cases: Reply[] = [KEY_ERROR_XML, { status: 401, body: KEY_ERROR_XML }, { status: 502, body: "" }, new Error(`getaddrinfo ENOTFOUND https://apis.data.go.kr/x?serviceKey=${KEY}`), Object.assign(new Error(`timed out ${KEY}`), { name: "TimeoutError" })];
    for (const r of cases) {
      const warn = vi.fn();
      const err = await make(mockFetch({ short: r, land: r, ta: r }), () => SEOUL, warn).week().then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(KmaError);
      const texts = [String((err as Error).message), (err as Error).stack ?? "", ...warn.mock.calls.flat().map(String)];
      for (const t of texts) {
        expect(t).not.toContain(KEY);
        expect(t).not.toContain("SECRET");
        expect(t).not.toContain("serviceKey");
        expect(t).not.toContain("http");
      }
    }
  });

  it("키 오류는 auth로 구분", async () => {
    await expect(make(mockFetch({ short: KEY_ERROR_XML, land: KEY_ERROR_XML, ta: KEY_ERROR_XML })).week()).rejects.toMatchObject({ kind: "auth" });
  });

  it("요청에 시간 제한 신호를 붙인다", async () => {
    let signal: AbortSignal | undefined;
    const f: KmaFetch = async (_u, init) => {
      signal = init.signal;
      return { ok: true, status: 200, text: async () => NO_DATA };
    };
    await new KmaWeatherSource({ serviceKey: KEY, fetch: f, now: () => FIXTURE_NOW, region: () => SEOUL, warn: () => {} }).week().catch(() => {});
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("cachedByRegion", () => {
  const day = (max: number) => [{ date: "2026-11-09", icon: "sunny" as const, max, min: 0 }];
  function setup(opts: { region?: () => KmaRegion | undefined } = {}) {
    let t = 1_000_000;
    let n = 0;
    const fail = { on: false };
    const src = {
      getRegion: opts.region ?? (() => SEOUL),
      forecast: vi.fn(async (r: KmaRegion) => {
        n++;
        if (fail.on) throw new KmaError("network", "연결 실패");
        return day(r.nx + n);
      }),
    };
    const warn = vi.fn();
    const c = cachedByRegion(src, { now: () => t, warn });
    return { c, src, warn, fail, advance: (ms: number) => (t += ms) };
  }
  const MIN = 60_000;

  it("30분 안에는 다시 받지 않고, 지나면 새로 받는다", async () => {
    const { c, src, advance } = setup();
    await c.week();
    advance(29 * MIN);
    await c.week();
    expect(src.forecast).toHaveBeenCalledTimes(1);
    advance(2 * MIN);
    await c.week();
    expect(src.forecast).toHaveBeenCalledTimes(2);
  });

  it("동시 요청은 하나로 합친다", async () => {
    const { c, src } = setup();
    const [a, b, d] = await Promise.all([c.week(), c.week(), c.week()]);
    expect(src.forecast).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(d);
  });

  it("지역이 바뀌면 TTL 안이어도 바로 새 지역으로 받고, 돌아오면 이전 지역 캐시를 쓴다", async () => {
    let region = SEOUL;
    const { c, src } = setup({ region: () => region });
    const seoul = await c.week();
    region = BUSAN;
    const busan = await c.week();
    expect(src.forecast).toHaveBeenLastCalledWith(BUSAN);
    expect(busan).not.toEqual(seoul);
    region = SEOUL;
    expect(await c.week()).toBe(seoul);
    expect(src.forecast).toHaveBeenCalledTimes(2);
    // 중기 코드만 바뀌어도 다른 지역
    region = { ...SEOUL, midTaRegId: "11B20201" };
    await c.week();
    expect(src.forecast).toHaveBeenCalledTimes(3);
  });

  it("갱신 실패 시 직전 성공값을 돌려주고, 5분 안에는 다시 시도하지 않는다", async () => {
    const { c, src, warn, fail, advance } = setup();
    const first = await c.week();
    advance(31 * MIN);
    fail.on = true;
    expect(await c.week()).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
    advance(4 * MIN);
    expect(await c.week()).toBe(first);
    expect(src.forecast).toHaveBeenCalledTimes(2); // 5분 전엔 재시도 없음
    advance(2 * MIN);
    fail.on = false;
    const again = await c.week();
    expect(src.forecast).toHaveBeenCalledTimes(3);
    expect(again).not.toBe(first);
  });

  it("직전 값이 6시간보다 오래되면 던진다", async () => {
    const { c, fail, advance } = setup();
    await c.week();
    fail.on = true;
    advance(6 * 60 * MIN + 1);
    await expect(c.week()).rejects.toBeInstanceOf(KmaError);
    advance(MIN);
    await expect(c.week()).rejects.toBeInstanceOf(KmaError); // 재시도 대기 중에도 같은 오류
  });

  it("처음부터 실패하면 던지고, 5분 뒤 다시 시도한다 (실패를 캐시해 굳히지 않음)", async () => {
    const { c, src, fail, advance } = setup();
    fail.on = true;
    await expect(c.week()).rejects.toBeInstanceOf(KmaError);
    await expect(c.week()).rejects.toBeInstanceOf(KmaError);
    expect(src.forecast).toHaveBeenCalledTimes(1);
    advance(5 * MIN);
    fail.on = false;
    await expect(c.week()).resolves.toHaveLength(1);
  });

  it("지역이 바뀌면 다른 지역의 실패 대기와 무관하게 받는다", async () => {
    let region = SEOUL;
    const { c, src, fail } = setup({ region: () => region });
    fail.on = true;
    await expect(c.week()).rejects.toBeInstanceOf(KmaError);
    fail.on = false;
    region = BUSAN;
    await expect(c.week()).resolves.toHaveLength(1);
    expect(src.forecast).toHaveBeenCalledTimes(2);
  });

  it("지역이 없으면 no_region", async () => {
    const { c } = setup({ region: () => undefined });
    await expect(c.week()).rejects.toMatchObject({ kind: "no_region" });
  });
});
