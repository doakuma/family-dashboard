// 기상청 어댑터(WeatherSource 구현)와 지역별 캐시. fetch·now·지역은 주입한다(키·네트워크 없이 시험 가능).
import { todayIn } from "../date";
import type { WeatherSource } from "../ports";
import type { WeatherDay } from "../types";
import { KmaError, PREV_MID_MS, PREV_SHORT_MS, extremesOf, mergeWeek, midTmFc, parseEnvelope, parseMidTerm, parseShortTerm, shortBase, type Extremes } from "./kma";

export interface KmaRegion {
  nx: number;
  ny: number;
  midLandRegId: string;
  midTaRegId: string;
}

/** fetch의 좁힌 모양(전역 fetch가 그대로 들어간다) */
export type KmaFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const BASE = "https://apis.data.go.kr/1360000";
export const KMA_ENDPOINTS = {
  short: `${BASE}/VilageFcstInfoService_2.0/getVilageFcst`,
  midLand: `${BASE}/MidFcstInfoService/getMidLandFcst`,
  midTa: `${BASE}/MidFcstInfoService/getMidTa`,
} as const;
export const KMA_TIMEOUT_MS = 10_000;

export interface KmaOptions {
  /** 공공데이터포털 '일반 인증키(Decoding)'. 로그·오류에 넣지 않는다 */
  serviceKey: string;
  fetch: KmaFetch;
  now?: () => Date;
  /** 지역이 없으면 undefined(week()가 no_region으로 실패) */
  region: () => KmaRegion | undefined | Promise<KmaRegion | undefined>;
  /** 파싱 경고(모르는 날씨 문구 등) */
  warn?: (message: string) => void;
}

/** 7일 예보 + 한쪽(단기/중기)만 받았는지(그러면 캐시를 짧게) */
export interface ForecastResult {
  days: WeatherDay[];
  partial?: boolean;
}

export class KmaWeatherSource implements WeatherSource {
  constructor(private readonly o: KmaOptions) {}

  /** 오늘 02시 발표분에서 받은 오늘 TMN/TMX: (지역, 날짜)당 하루 한 번만 받는다. 실패하면 넣지 않아 다음 갱신에 다시 시도 */
  private readonly extremes = new Map<string, Extremes>();

  getRegion() {
    return this.o.region();
  }

  async week(): Promise<WeatherDay[]> {
    const region = await this.o.region();
    if (!region) throw new KmaError("no_region", "날씨 지역이 정해지지 않았어요");
    return (await this.forecast(region)).days;
  }

  /** 단기 1회 + 중기 2회. 한쪽만 실패해도 나머지로 돌려주고, 결과가 비었는데 실패가 있으면 던진다. */
  async forecast(region: KmaRegion): Promise<ForecastResult> {
    const now = (this.o.now ?? (() => new Date()))();
    const today = todayIn(now);
    const warn = this.o.warn ?? ((m) => console.warn(`[weather] ${m}`));
    const [s, m] = await Promise.allSettled([this.short(region, now, today), this.mid(region, now)]);
    const errors = [s, m].flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
    for (const e of errors) warn(`기상청 일부 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    const short = s.status === "fulfilled" ? s.value : undefined;
    const mid = m.status === "fulfilled" ? m.value : undefined;
    for (const w of [...(short?.warnings ?? []), ...(mid?.warnings ?? [])]) warn(w);
    if (!short && !mid) throw errors[0] instanceof KmaError ? errors[0] : new KmaError("network", "기상청 요청 실패");
    const days = mergeWeek(today, short?.days ?? new Map(), mid?.days ?? new Map());
    if (!days.length && errors.length) throw errors[0] instanceof KmaError ? errors[0] : new KmaError("network", "기상청 요청 실패");
    return { days, partial: errors.length > 0 };
  }

  private async short(r: KmaRegion, now: Date, today: string) {
    const load = async (at: Date) => {
      const { baseDate, baseTime } = shortBase(at);
      const items = await this.get(KMA_ENDPOINTS.short, { base_date: baseDate, base_time: baseTime, nx: String(r.nx), ny: String(r.ny), numOfRows: "1500" });
      // 오늘 TMN(06시)·TMX(15시)는 그 시각이 지난 발표분에 없다 -> 오늘 02시 발표분에서 보충(02:10 전이면 해당 없음)
      const have = extremesOf(items, today);
      const sup = have.tmn !== undefined && have.tmx !== undefined ? undefined : await this.todayExtremes(r, at, today);
      return parseShortTerm(items, today, sup);
    };
    return this.orPrevious(() => load(now), () => load(new Date(now.getTime() - PREV_SHORT_MS)));
  }

  private async todayExtremes(r: KmaRegion, at: Date, today: string): Promise<Extremes | undefined> {
    const compact = today.replaceAll("-", "");
    const { baseDate, baseTime } = shortBase(at);
    if (baseDate !== compact || baseTime === "0200") return undefined; // 02:10 전(어제 23시 발표분에 있음) 또는 이미 02시 발표분
    const key = `${r.nx},${r.ny}|${today}`;
    const done = this.extremes.get(key);
    if (done) return done;
    try {
      const items = await this.get(KMA_ENDPOINTS.short, { base_date: compact, base_time: "0200", nx: String(r.nx), ny: String(r.ny), numOfRows: "1500" });
      const ex = extremesOf(items, today);
      for (const k of this.extremes.keys()) if (!k.endsWith(`|${today}`)) this.extremes.delete(k);
      this.extremes.set(key, ex);
      return ex;
    } catch (e) {
      (this.o.warn ?? ((m) => console.warn(`[weather] ${m}`)))(`오늘 최저·최고 보충(02시 발표분) 실패, 기온 극값으로 대신: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
      return undefined;
    }
  }

  private async mid(r: KmaRegion, now: Date) {
    const load = async (at: Date) => {
      const tmFc = midTmFc(at);
      const [land, ta] = await Promise.all([
        this.get(KMA_ENDPOINTS.midLand, { regId: r.midLandRegId, tmFc, numOfRows: "10" }),
        this.get(KMA_ENDPOINTS.midTa, { regId: r.midTaRegId, tmFc, numOfRows: "10" }),
      ]);
      return parseMidTerm(land[0], ta[0], tmFc);
    };
    return this.orPrevious(() => load(now), () => load(new Date(now.getTime() - PREV_MID_MS)));
  }

  /** 막 발표된 자료가 아직 없을 때(NO_DATA)만 직전 발표를 한 번 더 */
  private async orPrevious<T>(first: () => Promise<T>, previous: () => Promise<T>): Promise<T> {
    try {
      return await first();
    } catch (e) {
      if (e instanceof KmaError && e.kind === "no_data") return previous();
      throw e;
    }
  }

  /** 요청 하나. URL(인증키 포함)은 오류에 싣지 않는다. */
  private async get(endpoint: string, params: Record<string, string>) {
    const op = endpoint.slice(endpoint.lastIndexOf("/") + 1);
    const qs = new URLSearchParams({ serviceKey: this.o.serviceKey, pageNo: "1", dataType: "JSON", ...params });
    let res;
    try {
      res = await this.o.fetch(`${endpoint}?${qs}`, { signal: AbortSignal.timeout(KMA_TIMEOUT_MS) });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      throw name === "TimeoutError" || name === "AbortError" ? new KmaError("timeout", `기상청 ${op} 시간 초과`) : new KmaError("network", `기상청 ${op} 연결 실패`);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new KmaError("network", `기상청 ${op} 응답을 받지 못했어요`);
    }
    // 키 오류는 HTTP 200 + XML로도, 401/403 + XML로도 온다. 본문이 XML이면 그쪽 설명이 더 정확하다.
    if (!res.ok && !text.trim().startsWith("<")) throw new KmaError("http", `기상청 ${op} HTTP ${res.status}`);
    try {
      return parseEnvelope(text);
    } catch (e) {
      if (e instanceof KmaError) throw new KmaError(e.kind, `${op}: ${e.message}`);
      throw e;
    }
  }
}

// ---------- 지역별 캐시 ----------

export interface RegionalForecast {
  getRegion(): KmaRegion | undefined | Promise<KmaRegion | undefined>;
  forecast(region: KmaRegion): Promise<ForecastResult>;
}

export interface CacheOptions {
  now?: () => number;
  ttlMs?: number;
  /** 실패한 뒤 다시 시도하기까지. 한쪽만 받은 결과(partial)의 TTL로도 쓴다 */
  retryAfterMs?: number;
  /** 직전 성공값을 낡은 채로 돌려줄 수 있는 최대 나이 */
  maxStaleMs?: number;
  /** 지역별 항목을 최근 사용 순으로 이만큼만 둔다 */
  maxRegions?: number;
  warn?: (message: string) => void;
}
export const WEATHER_TTL_MS = 30 * 60_000;
export const WEATHER_RETRY_MS = 5 * 60_000;
export const WEATHER_MAX_STALE_MS = 6 * 3_600_000;

export const regionKey = (r: KmaRegion) => `${r.nx},${r.ny},${r.midLandRegId},${r.midTaRegId}`;

export type RegionalWeather = WeatherSource & { weekFor(region: KmaRegion): Promise<WeatherDay[]> };

/**
 * 지역별 캐시(stale-while-revalidate). 키 = 지역(격자 + 중기 코드 2개): 지역이 바뀌면 다음 요청에서 바로 새로 받는다.
 * - TTL(30분, 한쪽만 받은 결과는 5분) 안: 캐시값.
 * - TTL이 지났어도 같은 지역의 6시간 이내 값이 있으면 그 값을 바로 주고 뒤에서 새로 받는다(요청을 막지 않는다). 뒤 갱신 실패는 로그만.
 * - 직전 값이 없을 때(첫 요청·지역 변경·6시간 초과)만 기다린다. 실패하면 던지고 5분 동안은 다시 시도하지 않는다.
 * - 같은 지역의 동시 갱신은 하나로 합친다. 항목은 최근 사용 순(LRU)으로 4개까지.
 */
export function cachedByRegion(source: RegionalForecast, o: CacheOptions = {}): RegionalWeather {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? WEATHER_TTL_MS;
  const retry = o.retryAfterMs ?? WEATHER_RETRY_MS;
  const maxStale = o.maxStaleMs ?? WEATHER_MAX_STALE_MS;
  const maxRegions = o.maxRegions ?? 4;
  const warn = o.warn ?? ((m) => console.warn(`[weather] ${m}`));
  type Entry = { value?: WeatherDay[]; partial?: boolean; at: number; retryAt?: number; error?: unknown };
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<WeatherDay[]>>();

  const set = (key: string, e: Entry) => {
    entries.delete(key); // 맨 뒤로 = 가장 최근 사용
    entries.set(key, e);
    while (entries.size > maxRegions) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      entries.delete(oldest);
    }
  };
  const stale = (e: Entry | undefined, t: number) => (e?.value && t - e.at <= maxStale ? e.value : undefined);

  function refresh(key: string, region: KmaRegion): Promise<WeatherDay[]> {
    const running = inflight.get(key);
    if (running) return running;
    const p = source
      .forecast(region)
      .then(({ days, partial }) => {
        set(key, { value: days, partial, at: now() });
        return days;
      })
      .catch((err: unknown) => {
        const prev = entries.get(key);
        const v = stale(prev, now());
        warn(`날씨 갱신 실패(${v ? "직전 값을 보여 줘요" : "보여 줄 값 없음"}): ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
        // value·at은 유지하고 재시도 시각만 늦춘다
        set(key, { ...(prev ?? { at: now() }), retryAt: now() + retry, error: err });
        if (v) return v;
        throw err;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function weekFor(region: KmaRegion): Promise<WeatherDay[]> {
    const key = regionKey(region);
    const t = now();
    const e = entries.get(key);
    if (e) set(key, e); // 사용 순서 갱신
    const fresh = e?.value !== undefined && t - e.at < (e.partial ? retry : ttl);
    if (fresh && e?.value) return e.value;
    const old = stale(e, t);
    const waiting = e?.retryAt !== undefined && t < e.retryAt;
    if (old) {
      // 낡았지만 쓸 만한 값: 바로 주고, 뒤에서 새로 받는다(재시도 대기 중이면 받지 않는다)
      if (!waiting) refresh(key, region).catch(() => {});
      return old;
    }
    if (waiting) throw e?.error;
    return refresh(key, region);
  }

  return {
    weekFor,
    async week() {
      const region = await source.getRegion();
      if (!region) throw new KmaError("no_region", "날씨 지역이 정해지지 않았어요");
      return weekFor(region);
    },
  };
}
