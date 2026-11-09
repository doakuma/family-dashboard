// 기상청 어댑터(WeatherSource 구현)와 지역별 캐시. fetch·now·지역은 주입한다(키·네트워크 없이 시험 가능).
import { todayIn } from "../date";
import type { WeatherSource } from "../ports";
import type { WeatherDay } from "../types";
import { KmaError, PREV_MID_MS, PREV_SHORT_MS, mergeWeek, midTmFc, parseEnvelope, parseMidTerm, parseShortTerm, shortBase } from "./kma";

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

export class KmaWeatherSource implements WeatherSource {
  constructor(private readonly o: KmaOptions) {}

  getRegion() {
    return this.o.region();
  }

  async week(): Promise<WeatherDay[]> {
    const region = await this.o.region();
    if (!region) throw new KmaError("no_region", "날씨 지역이 정해지지 않았어요");
    return this.forecast(region);
  }

  /** 단기 1회 + 중기 2회. 한쪽만 실패해도 나머지로 돌려주고, 결과가 비었는데 실패가 있으면 던진다. */
  async forecast(region: KmaRegion): Promise<WeatherDay[]> {
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
    return days;
  }

  private async short(r: KmaRegion, now: Date, today: string) {
    const load = async (at: Date) => {
      const { baseDate, baseTime } = shortBase(at);
      const items = await this.get(KMA_ENDPOINTS.short, { base_date: baseDate, base_time: baseTime, nx: String(r.nx), ny: String(r.ny), numOfRows: "1500" });
      return parseShortTerm(items, today);
    };
    return this.orPrevious(() => load(now), () => load(new Date(now.getTime() - PREV_SHORT_MS)));
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
  forecast(region: KmaRegion): Promise<WeatherDay[]>;
}

export interface CacheOptions {
  now?: () => number;
  ttlMs?: number;
  /** 실패한 뒤 다시 시도하기까지 */
  retryAfterMs?: number;
  /** 실패했을 때 직전 성공값을 돌려줄 수 있는 최대 나이 */
  maxStaleMs?: number;
  warn?: (message: string) => void;
}
export const WEATHER_TTL_MS = 30 * 60_000;
export const WEATHER_RETRY_MS = 5 * 60_000;
export const WEATHER_MAX_STALE_MS = 6 * 3_600_000;

export const regionKey = (r: KmaRegion) => `${r.nx},${r.ny},${r.midLandRegId},${r.midTaRegId}`;

/** 30분 캐시. 키 = 지역(격자 + 중기 코드 2개): 지역이 바뀌면 다음 요청에서 바로 새로 받는다. 동시 요청은 하나로 합친다. */
export function cachedByRegion(source: RegionalForecast, o: CacheOptions = {}): WeatherSource {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? WEATHER_TTL_MS;
  const retry = o.retryAfterMs ?? WEATHER_RETRY_MS;
  const maxStale = o.maxStaleMs ?? WEATHER_MAX_STALE_MS;
  const warn = o.warn ?? ((m) => console.warn(`[weather] ${m}`));
  type Entry = { value?: WeatherDay[]; at: number; retryAt?: number; error?: unknown };
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<WeatherDay[]>>();

  const stale = (e: Entry | undefined, t: number) => (e?.value && t - e.at <= maxStale ? e.value : undefined);

  return {
    async week() {
      const region = await source.getRegion();
      if (!region) throw new KmaError("no_region", "날씨 지역이 정해지지 않았어요");
      const key = regionKey(region);
      const t = now();
      const e = entries.get(key);
      if (e?.value && t - e.at < ttl) return e.value;
      if (e?.retryAt !== undefined && t < e.retryAt) {
        const v = stale(e, t);
        if (v) return v;
        throw e.error;
      }
      const running = inflight.get(key);
      if (running) return running;
      const p = source
        .forecast(region)
        .then((value) => {
          entries.set(key, { value, at: now() });
          return value;
        })
        .catch((err: unknown) => {
          const prev = entries.get(key);
          const msg = err instanceof Error ? err.message : "알 수 없는 오류";
          const v = stale(prev, now());
          warn(`날씨 갱신 실패(${v ? "직전 값을 보여 줘요" : "보여 줄 값 없음"}): ${msg}`);
          // value·at은 유지하고 재시도 시각만 늦춘다
          entries.set(key, { ...(prev ?? { at: now() }), retryAt: now() + retry, error: err });
          if (v) return v;
          throw err;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      // 오래 안 쓴 지역 항목 정리(지역이 바뀐 뒤 옛 값이 쌓이지 않게)
      for (const k of [...entries.keys()].slice(0, Math.max(0, entries.size - 4))) entries.delete(k);
      return p;
    },
  };
}
