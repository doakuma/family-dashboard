// 기상청 예보 순수 모듈(브라우저 안전, 네트워크 없음): 발표 시각 계산, 응답 파싱, 합치기. 규칙의 이유는 docs/decisions/0011-kma-weather.md.
import { addDays } from "../date";
import type { WeatherDay, WeatherIcon } from "../types";

/** 오류 종류. 메시지에는 URL·인증키를 넣지 않는다. */
export type KmaErrorKind = "auth" | "api" | "no_data" | "http" | "network" | "timeout" | "format" | "no_region";

export class KmaError extends Error {
  constructor(
    readonly kind: KmaErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "KmaError";
  }
}

// ---------- 발표 시각 ----------

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** 발표 정각 뒤 API에 올라오기까지 기다리는 시간. 단기는 "약 10분", 중기는 넉넉히 30분(실연결 때 확인) */
export const SHORT_MARGIN_MIN = 10;
export const MID_MARGIN_MIN = 30;
const SHORT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

const p2 = (n: number) => String(n).padStart(2, "0");
/** 서울 시각의 달력 값(UTC 필드로 읽는다). 서울은 일광절약이 없어 +9시간 고정. */
function kst(ms: number) {
  const d = new Date(ms + 9 * HOUR);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() };
}
const ymd = (c: { y: number; mo: number; d: number }) => `${c.y}${p2(c.mo)}${p2(c.d)}`;
const dash = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/** 단기예보 base_date/base_time. 02·05·…·23시 발표, 정각 + 10분 뒤부터 사용. 02:10 전이면 전날 23시. */
export function shortBase(now: Date): { baseDate: string; baseTime: string } {
  const c = kst(now.getTime() - SHORT_MARGIN_MIN * MINUTE);
  const h = [...SHORT_HOURS].reverse().find((x) => x <= c.h);
  if (h === undefined) return { baseDate: ymd(kst(now.getTime() - SHORT_MARGIN_MIN * MINUTE - 24 * HOUR)), baseTime: "2300" };
  return { baseDate: ymd(c), baseTime: `${p2(h)}00` };
}

/** 중기예보 tmFc(YYYYMMDDHHMM). 06·18시 발표, 정각 + 30분 뒤부터 사용. 06:30 전이면 전날 18시. */
export function midTmFc(now: Date): string {
  const t = now.getTime() - MID_MARGIN_MIN * MINUTE;
  const c = kst(t);
  if (c.h >= 18) return `${ymd(c)}1800`;
  if (c.h >= 6) return `${ymd(c)}0600`;
  return `${ymd(kst(t - 24 * HOUR))}1800`;
}

/** 직전 발표(NO_DATA 때 한 번 더 시도): 단기는 3시간, 중기는 12시간 전 시각으로 다시 계산하면 된다 */
export const PREV_SHORT_MS = 3 * HOUR;
export const PREV_MID_MS = 12 * HOUR;

// ---------- 응답 봉투 ----------

type Item = Record<string, unknown>;

/** 응답 본문 -> item 배열. 오류 응답(JSON 오류코드, 키 오류 XML)은 KmaError로 던진다. */
export function parseEnvelope(text: string): Item[] {
  const body = text.trim();
  if (body.startsWith("<")) {
    // dataType=JSON이어도 인증 오류는 XML(<OpenAPI_ServiceResponse>)로 온다
    const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(body)?.[1]?.trim();
    const code = /<returnReasonCode>([^<]*)<\/returnReasonCode>/.exec(body)?.[1]?.trim();
    const label = [msg, code && `코드 ${code}`].filter(Boolean).join(", ") || "알 수 없는 오류";
    throw new KmaError("auth", `기상청 인증/서비스 오류: ${label}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new KmaError("format", "기상청 응답을 읽을 수 없어요 (JSON 아님)");
  }
  const res = (json as { response?: { header?: { resultCode?: unknown; resultMsg?: unknown }; body?: { items?: unknown } } } | null)?.response;
  const code = res?.header?.resultCode;
  if (typeof code !== "string" && typeof code !== "number") throw new KmaError("format", "기상청 응답 형식이 달라요 (header 없음)");
  const codeStr = String(code).padStart(2, "0");
  if (codeStr === "03") throw new KmaError("no_data", "기상청 NO_DATA (아직 발표 전이거나 해당 자료 없음)");
  if (codeStr !== "00") throw new KmaError("api", `기상청 오류 ${codeStr}: ${String(res?.header?.resultMsg ?? "")}`.trim());
  const items = res?.body?.items;
  if (!items || typeof items !== "object") return []; // "items": "" 처럼 비어 오는 경우
  const item = (items as { item?: unknown }).item;
  if (Array.isArray(item)) return item.filter((x): x is Item => !!x && typeof x === "object");
  return item && typeof item === "object" ? [item as Item] : [];
}

// ---------- 아이콘 ----------

const RANK: Record<WeatherIcon, number> = { sunny: 0, partly: 1, cloudy: 2, shower: 3, rain: 4, snow: 5 };
const isPrecip = (i: WeatherIcon) => RANK[i] >= RANK.shower;

/** 중기 wf 문자열 -> 아이콘. 모르는 문자열은 undefined. 비/눈(진눈깨비)은 snow. */
export function iconFromWf(wf: string): WeatherIcon | undefined {
  const s = wf.replace(/\s+/g, "");
  if (!s) return undefined;
  if (s.includes("눈")) return "snow";
  if (s.includes("소나기")) return "shower";
  if (s.includes("비")) return "rain";
  if (s.startsWith("맑")) return "sunny";
  if (s.startsWith("구름")) return "partly";
  if (s.startsWith("흐")) return "cloudy";
  return undefined;
}

/** PTY 코드 -> 강수 아이콘(0 없음). 1 비, 2 비/눈, 3 눈, 4 소나기, (5 빗방울, 6 빗방울눈날림, 7 눈날림은 초단기 코드지만 방어) */
function iconFromPty(pty: number): WeatherIcon | undefined {
  if (pty === 1 || pty === 5) return "rain";
  if (pty === 2 || pty === 3 || pty === 6 || pty === 7) return "snow";
  if (pty === 4) return "shower";
  return undefined;
}

// ---------- 단기예보 ----------

const num = (v: unknown): number | undefined => {
  if (typeof v === "string" && v.trim() === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > -900 ? n : undefined; // -999 등은 결측 표시
};

export interface Extremes {
  tmn?: number;
  tmx?: number;
}

/** 응답에서 그날의 TMN/TMX만 꺼낸다(오늘 값이 빠졌는지 보고, 02시 발표분에서 보충값을 읽을 때 쓴다) */
export function extremesOf(items: Item[], dashDate: string): Extremes {
  const out: Extremes = {};
  for (const it of items) {
    if (typeof it.fcstDate !== "string" || it.fcstDate.length !== 8 || dash(it.fcstDate) !== dashDate) continue;
    const v = num(it.fcstValue);
    if (v === undefined) continue;
    if (it.category === "TMN") out.tmn = v;
    else if (it.category === "TMX") out.tmx = v;
  }
  return out;
}

export interface Parsed {
  days: Map<string, WeatherDay>;
  warnings: string[];
}

/**
 * getVilageFcst item[] -> 날짜별 하루 예보.
 * - 최저/최고: TMN/TMX, 없으면 supplement(오늘 02시 발표분에서 받은 오늘 값, 오늘에만), 그래도 없으면 그날 TMP의 최저/최고(오늘은 지난 시각이 빠져 있어 실제와 다를 수 있다)
 * - 강수확률: 그날 POP의 최대
 * - 아이콘: 낮(06~21시) 시간대만 본다. PTY가 하나라도 있으면 강수 아이콘(눈·진눈깨비 > 비 > 소나기), 없으면 SKY 평균(맑음 0, 구름많음 1, 흐림 2)
 * - 낮 자료가 없는 날은 오늘만 전체 시각으로 대신하고, 나머지는 뺀다(0시 한 칸만 걸친 먼 날이 중기를 가리지 않게)
 */
export function parseShortTerm(items: Item[], today: string, supplement?: Extremes): Parsed {
  type Acc = { tmp: number[]; tmn?: number; tmx?: number; pop: number[]; sky: Map<string, number>; pty: Map<string, number> };
  const byDate = new Map<string, Acc>();
  for (const it of items) {
    const date = typeof it.fcstDate === "string" && /^\d{8}$/.test(it.fcstDate) ? dash(it.fcstDate) : undefined;
    const time = typeof it.fcstTime === "string" ? it.fcstTime : "";
    const v = num(it.fcstValue);
    if (!date || v === undefined) continue;
    let a = byDate.get(date);
    if (!a) byDate.set(date, (a = { tmp: [], pop: [], sky: new Map(), pty: new Map() }));
    switch (it.category) {
      case "TMP": a.tmp.push(v); break;
      case "TMN": a.tmn = v; break;
      case "TMX": a.tmx = v; break;
      case "POP": a.pop.push(v); break;
      case "SKY": a.sky.set(time, v); break;
      case "PTY": a.pty.set(time, v); break;
    }
  }
  const days = new Map<string, WeatherDay>();
  const warnings: string[] = [];
  for (const [date, a] of [...byDate].sort(([x], [y]) => x.localeCompare(y))) {
    const isDay = (t: string) => t >= "0600" && t <= "2100";
    const times = new Set([...a.sky.keys(), ...a.pty.keys()]);
    const dayTimes = [...times].filter(isDay);
    if (!dayTimes.length && date !== today) continue;
    const use = dayTimes.length ? dayTimes : [...times];
    let icon: WeatherIcon | undefined;
    for (const t of use) {
      const p = iconFromPty(a.pty.get(t) ?? 0);
      if (p && (!icon || RANK[p] > RANK[icon])) icon = p;
    }
    if (!icon) {
      const skies = use.map((t) => a.sky.get(t)).filter((x): x is number => x !== undefined).map((x) => (x <= 1 ? 0 : x === 3 ? 1 : 2));
      if (!skies.length) continue;
      const mean = skies.reduce<number>((s, x) => s + x, 0) / skies.length;
      icon = mean < 0.5 ? "sunny" : mean < 1.5 ? "partly" : "cloudy";
    }
    const sup = date === today ? supplement : undefined;
    const max = a.tmx ?? sup?.tmx ?? (a.tmp.length ? Math.max(...a.tmp) : undefined);
    const min = a.tmn ?? sup?.tmn ?? (a.tmp.length ? Math.min(...a.tmp) : undefined);
    if (max === undefined || min === undefined) {
      warnings.push(`단기예보 ${date}: 기온 값이 없어 뺐어요`);
      continue;
    }
    days.set(date, { date, icon, max: Math.round(max), min: Math.round(min), ...(a.pop.length ? { pop: Math.round(Math.max(...a.pop)) } : {}) });
  }
  return { days, warnings };
}

// ---------- 중기예보 ----------

/** tmFc 날짜 기준 n일 뒤 (n은 3~10 중 응답에 있는 것만 본다) */
const MID_N = [3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * getMidLandFcst(wf{n}Am/Pm 또는 wf{n}, rnSt{n}Am/Pm 또는 rnSt{n}) + getMidTa(taMin{n}, taMax{n}) -> 날짜별 하루 예보.
 * 아이콘: 오전/오후 중 강수가 있으면 그중 가장 센 것, 없으면 오후(없으면 오전). 강수확률은 오전/오후 중 큰 값.
 * 기온이 하나라도 없는 날은 뺀다. 모르는 wf 문자열은 흐림(cloudy)으로 두고 경고.
 */
export function parseMidTerm(land: Item | undefined, ta: Item | undefined, tmFc: string): Parsed {
  const days = new Map<string, WeatherDay>();
  const warnings: string[] = [];
  if (!land || !ta) return { days, warnings };
  const base = dash(tmFc.slice(0, 8));
  for (const n of MID_N) {
    const wfs = [land[`wf${n}Am`], land[`wf${n}Pm`], land[`wf${n}`]].filter((x): x is string => typeof x === "string" && x.trim() !== "");
    const max = num(ta[`taMax${n}`]);
    const min = num(ta[`taMin${n}`]);
    if (!wfs.length || max === undefined || min === undefined) continue;
    const icons = wfs.map((w) => {
      const i = iconFromWf(w);
      if (!i) warnings.push(`중기예보 모르는 날씨 문구 "${w}" -> 흐림으로 표시`);
      return i ?? "cloudy";
    });
    const precip = icons.filter(isPrecip).sort((a, b) => RANK[b] - RANK[a])[0];
    const icon = precip ?? icons[icons.length - 1] ?? "cloudy"; // 마지막 = Pm(없으면 Am, 단일이면 그 값)
    const pops = [land[`rnSt${n}Am`], land[`rnSt${n}Pm`], land[`rnSt${n}`]].map(num).filter((x): x is number => x !== undefined);
    const date = addDays(base, n);
    days.set(date, { date, icon, max: Math.round(max), min: Math.round(min), ...(pops.length ? { pop: Math.round(Math.max(...pops)) } : {}) });
  }
  return { days, warnings };
}

// ---------- 합치기 ----------

/** 오늘부터 7일(오늘 포함). 날짜마다 단기 우선, 없으면 중기. 값이 없는 날은 빠진다. */
export function mergeWeek(today: string, short: Map<string, WeatherDay>, mid: Map<string, WeatherDay>): WeatherDay[] {
  const out: WeatherDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const d = short.get(date) ?? mid.get(date);
    if (d) out.push(d);
  }
  return out;
}
