// 날씨 어댑터 연결. KMA_SERVICE_KEY와 위키 config의 기상청 좌표 4개가 있으면 기상청(+30분 지역별 캐시), 아니면 예시 데이터.
// 기상청 구현·캐시는 @hsh/core(weather/). 여기는 어떤 걸 쓸지 고르는 일만 한다.
import { KmaWeatherSource, addDays, cachedByRegion, todayIn, type FamilyConfig, type KmaFetch, type KmaRegion, type WeatherDay, type WeatherIcon, type WeatherSource } from "@hsh/core";

export class SampleWeatherSource implements WeatherSource {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async week(): Promise<WeatherDay[]> {
    const today = todayIn(this.now());
    const icons: WeatherIcon[] = ["sunny", "partly", "cloudy", "rain", "partly", "sunny", "sunny"];
    const max = [17, 16, 14, 12, 13, 15, 16];
    const min = [7, 8, 9, 8, 5, 4, 6];
    const pop = [0, 10, 30, 80, 20, 0, 0];
    return icons.map((icon, i) => ({ date: addDays(today, i), icon, max: max[i] ?? 0, min: min[i] ?? 0, pop: pop[i] }));
  }
}

/** config의 기상청 좌표 4개가 모두 있을 때만 지역으로 본다 */
export function regionFromConfig(c: Pick<FamilyConfig, "kmaNx" | "kmaNy" | "kmaMidLandRegId" | "kmaMidTaRegId"> | undefined): KmaRegion | undefined {
  if (!c || c.kmaNx === undefined || c.kmaNy === undefined || !c.kmaMidLandRegId || !c.kmaMidTaRegId) return undefined;
  return { nx: c.kmaNx, ny: c.kmaNy, midLandRegId: c.kmaMidLandRegId, midTaRegId: c.kmaMidTaRegId };
}

export interface WeatherDeps {
  serviceKey?: string;
  /** 지금 위키 config의 지역(읽기만). 요청마다 부르므로 #22에서 바뀐 지역이 다음 요청에 반영된다 */
  region: () => KmaRegion | undefined;
  fetch?: KmaFetch;
  now?: () => Date;
}

export function createWeatherSource(deps?: WeatherDeps): WeatherSource {
  const sample = new SampleWeatherSource(deps?.now);
  if (!deps?.serviceKey) return sample;
  const now = deps.now ?? (() => new Date());
  const kma = cachedByRegion(
    new KmaWeatherSource({ serviceKey: deps.serviceKey, fetch: deps.fetch ?? ((url, init) => fetch(url, init)), now, region: deps.region }),
    { now: () => now().getTime() },
  );
  return {
    // 지역이 아직 없으면(세팅 전·좌표 일부 없음) 예시 날씨. 지역은 요청당 한 번만 읽는다
    week: () => {
      const region = deps.region();
      return region ? kma.weekFor(region) : sample.week();
    },
  };
}
