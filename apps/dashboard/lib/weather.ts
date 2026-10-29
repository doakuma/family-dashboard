// 날씨 어댑터. 기상청 키(#26)가 준비되기 전까지는 예시 데이터를 쓴다.
// KmaWeatherSource(#12)가 생기면 createWeatherSource에서 바꾸기만 하면 된다.
import { addDays, todayIn, type WeatherDay, type WeatherIcon, type WeatherSource } from "@hsh/core";

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

/** 30분 캐시 */
export function cached(source: WeatherSource, ttlMs = 30 * 60_000): WeatherSource {
  let hit: { at: number; value: Promise<WeatherDay[]> } | undefined;
  return {
    week() {
      if (!hit || Date.now() - hit.at > ttlMs) {
        const value = source.week().catch((e) => {
          hit = undefined;
          throw e;
        });
        hit = { at: Date.now(), value };
      }
      return hit.value;
    },
  };
}

export function createWeatherSource(): WeatherSource {
  return cached(new SampleWeatherSource());
}
