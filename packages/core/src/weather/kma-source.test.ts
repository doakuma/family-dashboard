import { describe, expect, it, vi } from "vitest";
import { APP_ERROR, FIXTURE_NOW, KEY_ERROR_XML, MID_LAND_OK, MID_TA_OK, NO_DATA, SHORT_0200, SHORT_OK, withoutCategories } from "./__fixtures__/kma-fixtures";
import { KmaError } from "./kma";
import { KMA_ENDPOINTS, KmaWeatherSource, cachedByRegion, type KmaFetch, type KmaRegion } from "./kma-source";

const KEY = "SECRET+key/with=chars==";
const SEOUL: KmaRegion = { nx: 60, ny: 127, midLandRegId: "11B00000", midTaRegId: "11B10101" };
const BUSAN: KmaRegion = { nx: 98, ny: 76, midLandRegId: "11H20000", midTaRegId: "11H20201" };

type Reply = string | { status: number; body: string } | Error;
/** URL 접두에 따라 답하는 fetch 목. 호출 URL을 기록한다. */
function mockFetch(replies: { short?: Reply | ((url: string) => Reply); land?: Reply; ta?: Reply }, delayMs = 0) {
  const calls: string[] = [];
  const f: KmaFetch = async (url) => {
    calls.push(url);
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    const shortReply = typeof replies.short === "function" ? replies.short(url) : replies.short;
    const r = url.startsWith(KMA_ENDPOINTS.short) ? shortReply : url.startsWith(KMA_ENDPOINTS.midLand) ? replies.land : replies.ta;
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

describe("오늘 최저·최고 보충 (02시 발표분)", () => {
  const at = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00+09:00`);
  const baseTimeOf = (url: string) => new URL(url).searchParams.get("base_time");
  function run(hhmm: string, current: string, opts: { zero2?: Reply } = {}) {
    const m = mockFetch({ short: (url) => (baseTimeOf(url) === "0200" ? (opts.zero2 ?? SHORT_0200) : current), land: MID_LAND_OK, ta: MID_TA_OK });
    let now = at(hhmm);
    const src = new KmaWeatherSource({ serviceKey: KEY, fetch: m.f, now: () => now, region: () => SEOUL, warn: vi.fn() });
    return { m, src, setNow: (d: Date) => (now = d), zero2Calls: () => m.calls.filter((u) => baseTimeOf(u) === "0200").length };
  }
  const noExtremes = withoutCategories(SHORT_OK, "TMN", "TMX");

  it("08시: 최저(06시)가 지난 발표분이면 02시 발표분의 값을 쓴다", async () => {
    const r = run("08:30", withoutCategories(SHORT_OK, "TMN"));
    const [today] = await r.src.week();
    expect(today).toMatchObject({ date: "2026-11-09", min: 4, max: 15 }); // 최저는 02시분 4, 최고는 응답에 있던 15
  });

  it("18시: 최저·최고 둘 다 보충", async () => {
    const r = run("18:30", noExtremes);
    const [today] = await r.src.week();
    expect(today).toMatchObject({ min: 4, max: 16 });
  });

  it("응답에 둘 다 있으면 02시 발표분을 받지 않는다", async () => {
    const r = run("08:30", SHORT_OK);
    await r.src.week();
    expect(r.zero2Calls()).toBe(0);
  });

  it("같은 날 두 번째 갱신에서는 02시 요청을 다시 하지 않고, 다음 날은 다시 받는다", async () => {
    const r = run("08:30", noExtremes);
    await r.src.week();
    r.setNow(at("09:10"));
    const [today] = await r.src.week();
    expect(r.zero2Calls()).toBe(1);
    expect(today).toMatchObject({ min: 4, max: 16 });
    r.setNow(at("23:20")); // 23시 발표분 + 같은 날: 여전히 1회
    await r.src.week();
    expect(r.zero2Calls()).toBe(1);
  });

  it("02:10 전에는 보충하지 않는다(어제 23시 발표분에 오늘 값이 있다)", async () => {
    const r = run("01:30", noExtremes);
    await r.src.week().catch(() => {});
    expect(r.zero2Calls()).toBe(0);
  });

  it("02시 발표분 요청이 실패하면 TMP 극값으로 대신하고 다음 갱신에 다시 시도한다", async () => {
    const r = run("08:30", noExtremes, { zero2: NO_DATA });
    const [first] = await r.src.week();
    expect(first).toMatchObject({ min: 5, max: 15 });
    expect(r.zero2Calls()).toBe(1);
    await r.src.week();
    expect(r.zero2Calls()).toBe(2); // 실패는 저장하지 않음
  });
});

describe("cachedByRegion", () => {
  const day = (max: number) => [{ date: "2026-11-09", icon: "sunny" as const, max, min: 0 }];
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function setup(opts: { region?: () => KmaRegion | undefined; partial?: boolean; maxRegions?: number } = {}) {
    let t = 1_000_000;
    let n = 0;
    const fail = { on: false };
    const src = {
      getRegion: opts.region ?? (() => SEOUL),
      forecast: vi.fn(async (r: KmaRegion) => {
        n++;
        if (fail.on) throw new KmaError("network", "연결 실패");
        return { days: day(r.nx + n), partial: opts.partial };
      }),
    };
    const warn = vi.fn();
    const c = cachedByRegion(src, { now: () => t, warn, maxRegions: opts.maxRegions });
    return { c, src, warn, fail, advance: (ms: number) => (t += ms) };
  }
  const MIN = 60_000;

  it("30분 안에는 다시 받지 않는다", async () => {
    const { c, src, advance } = setup();
    await c.week();
    advance(29 * MIN);
    await c.week();
    expect(src.forecast).toHaveBeenCalledTimes(1);
  });

  it("TTL이 지나면 낡은 값을 바로 주고 뒤에서 새로 받는다 (요청을 막지 않음)", async () => {
    const { c, src, advance } = setup();
    const first = await c.week();
    advance(31 * MIN);
    let release!: () => void;
    src.forecast.mockImplementationOnce(() => new Promise((res) => (release = () => res({ days: day(999), partial: undefined }))));
    expect(await c.week()).toBe(first); // 갱신이 끝나지 않았어도 즉시
    expect(src.forecast).toHaveBeenCalledTimes(2);
    expect(await c.week()).toBe(first); // 갱신 중 또 와도 같은 값, 갱신은 하나
    expect(src.forecast).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect((await c.week())[0]?.max).toBe(999);
  });

  it("뒤 갱신이 실패해도 unhandled rejection 없이 로그만 남고, 5분 동안은 다시 받지 않는다", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { c, src, warn, fail, advance } = setup();
    const first = await c.week();
    advance(31 * MIN);
    fail.on = true;
    expect(await c.week()).toBe(first);
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    advance(4 * MIN);
    expect(await c.week()).toBe(first);
    await flush();
    expect(src.forecast).toHaveBeenCalledTimes(2);
    advance(2 * MIN);
    fail.on = false;
    expect(await c.week()).toBe(first); // 이번에도 낡은 값을 주고 뒤에서 갱신
    await flush();
    expect(src.forecast).toHaveBeenCalledTimes(3);
    expect(await c.week()).not.toBe(first);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("직전 값이 없을 때(첫 요청)는 기다리고, 동시 요청은 지연 있는 fetch에서도 하나로 합친다", async () => {
    const m = mockFetch(ok, 20);
    const kma = new KmaWeatherSource({ serviceKey: KEY, fetch: m.f, now: () => FIXTURE_NOW, region: () => SEOUL, warn: vi.fn() });
    const c = cachedByRegion(kma);
    const [a, b, d] = await Promise.all([c.week(), c.week(), c.week()]);
    expect(m.calls).toHaveLength(3); // 단기 1 + 중기 2, 합쳐서 한 번만
    expect(a).toBe(b);
    expect(b).toBe(d);
    expect(a).toHaveLength(7);
  });

  it("지역이 바뀌면 TTL 안이어도 바로 새 지역으로 받고(기다림), 돌아오면 이전 지역 캐시를 쓴다", async () => {
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
    region = { ...SEOUL, midTaRegId: "11B20201" };
    await c.week();
    expect(src.forecast).toHaveBeenCalledTimes(3);
  });

  it("직전 값이 6시간보다 오래되면 기다렸다가 던진다", async () => {
    const { c, fail, advance } = setup();
    await c.week();
    fail.on = true;
    advance(6 * 60 * MIN + 1);
    await expect(c.week()).rejects.toBeInstanceOf(KmaError);
    advance(MIN);
    await expect(c.week()).rejects.toBeInstanceOf(KmaError); // 재시도 대기 중에도 같은 오류
  });

  it("처음부터 실패하면 던지고, 5분 뒤 다시 시도한다", async () => {
    const { c, src, fail, advance } = setup();
    fail.on = true;
    await expect(c.week()).rejects.toBeInstanceOf(KmaError);
    await expect(c.week()).rejects.toBeInstanceOf(KmaError);
    expect(src.forecast).toHaveBeenCalledTimes(1);
    advance(5 * MIN);
    fail.on = false;
    await expect(c.week()).resolves.toHaveLength(1);
  });

  it("한쪽만 받은 결과(partial)는 5분만 캐시한다", async () => {
    const { c, src, advance } = setup({ partial: true });
    await c.week();
    advance(4 * MIN);
    await c.week();
    expect(src.forecast).toHaveBeenCalledTimes(1);
    advance(2 * MIN);
    await c.week(); // 낡은 값을 주고 뒤에서 갱신
    await flush();
    expect(src.forecast).toHaveBeenCalledTimes(2);
  });

  it("지역별 항목은 최근 사용 순(LRU)으로 남긴다", async () => {
    let id = 1;
    const mk = () => ({ nx: id, ny: 1, midLandRegId: "11B00000", midTaRegId: "11B10101" });
    let region = mk();
    const { c, src } = setup({ region: () => region, maxRegions: 2 });
    const r1 = mk();
    region = r1;
    await c.week(); // A
    id = 2;
    region = mk();
    await c.week(); // B
    region = r1;
    await c.week(); // A 사용 -> A가 최근
    id = 3;
    region = mk();
    await c.week(); // C -> 가장 오래 안 쓴 B가 밀려남
    expect(src.forecast).toHaveBeenCalledTimes(3);
    region = r1;
    await c.week(); // A는 남아 있음
    expect(src.forecast).toHaveBeenCalledTimes(3);
    region = { ...r1, nx: 2 };
    await c.week(); // B는 없음 -> 다시 받음
    expect(src.forecast).toHaveBeenCalledTimes(4);
  });

  it("weekFor는 넘긴 지역을 쓰고 지역 getter를 읽지 않는다", async () => {
    const getRegion = vi.fn(() => SEOUL);
    const src = { getRegion, forecast: vi.fn(async () => ({ days: [] })) };
    await cachedByRegion(src).weekFor(BUSAN);
    expect(getRegion).not.toHaveBeenCalled();
  });

  it("지역이 없으면 no_region", async () => {
    const { c } = setup({ region: () => undefined });
    await expect(c.week()).rejects.toMatchObject({ kind: "no_region" });
  });
});
