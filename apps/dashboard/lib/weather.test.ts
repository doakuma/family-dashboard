import { describe, expect, it, vi } from "vitest";
import type { KmaFetch } from "@hsh/core";
import { APP_ERROR, FIXTURE_NOW, MID_LAND_OK, MID_TA_OK, SHORT_OK } from "../../../packages/core/src/weather/__fixtures__/kma-fixtures";
import { SampleWeatherSource, createWeatherSource, regionFromConfig } from "./weather";

const REGION = { nx: 60, ny: 127, midLandRegId: "11B00000", midTaRegId: "11B10101" };

function fetchMock() {
  const urls: string[] = [];
  const f: KmaFetch = async (url) => {
    urls.push(url);
    const body = url.includes("getVilageFcst") ? SHORT_OK : url.includes("getMidLandFcst") ? MID_LAND_OK : url.includes("getMidTa") ? MID_TA_OK : APP_ERROR;
    return { ok: true, status: 200, text: async () => body };
  };
  return { f, urls };
}

describe("regionFromConfig", () => {
  it("4개가 다 있어야 지역", () => {
    expect(regionFromConfig({ kmaNx: 60, kmaNy: 127, kmaMidLandRegId: "11B00000", kmaMidTaRegId: "11B10101" })).toEqual(REGION);
    expect(regionFromConfig({ kmaNx: 60, kmaNy: 127, kmaMidLandRegId: "11B00000" })).toBeUndefined();
    expect(regionFromConfig({})).toBeUndefined();
    expect(regionFromConfig(undefined)).toBeUndefined();
  });
});

describe("createWeatherSource", () => {
  it("키가 없으면 예시 날씨 (기상청 호출 없음)", async () => {
    const { f, urls } = fetchMock();
    const w = createWeatherSource({ region: () => REGION, fetch: f, now: () => FIXTURE_NOW });
    expect(await w.week()).toEqual(await new SampleWeatherSource(() => FIXTURE_NOW).week());
    expect(urls).toHaveLength(0);
    expect(await createWeatherSource().week()).toHaveLength(7);
  });

  it("키는 있어도 지역(좌표)이 없으면 예시 날씨", async () => {
    const { f, urls } = fetchMock();
    const w = createWeatherSource({ serviceKey: "k", region: () => undefined, fetch: f, now: () => FIXTURE_NOW });
    expect(await w.week()).toEqual(await new SampleWeatherSource(() => FIXTURE_NOW).week());
    expect(urls).toHaveLength(0);
  });

  it("키 + 지역이 있으면 기상청, 30분 캐시, 지역이 바뀌면 새로 받는다", async () => {
    const { f, urls } = fetchMock();
    let region = REGION;
    const w = createWeatherSource({ serviceKey: "k", region: () => region, fetch: f, now: () => FIXTURE_NOW });
    const days = await w.week();
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: "2026-11-09", icon: "partly", max: 15, min: 5 });
    await w.week();
    expect(urls).toHaveLength(3);
    region = { nx: 98, ny: 76, midLandRegId: "11H20000", midTaRegId: "11H20201" };
    await w.week();
    expect(urls).toHaveLength(6);
    expect(urls.slice(3).some((u) => u.includes("nx=98") && u.includes("ny=76"))).toBe(true);
    expect(urls.slice(3).some((u) => u.includes("regId=11H20000"))).toBe(true);
  });

  it("기상청이 전부 실패하면 던진다 (getDashboardState가 빈 날씨로 처리)", async () => {
    const bad: KmaFetch = async () => ({ ok: true, status: 200, text: async () => APP_ERROR });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = createWeatherSource({ serviceKey: "k", region: () => REGION, fetch: bad, now: () => FIXTURE_NOW });
    await expect(w.week()).rejects.toThrow();
    warn.mockRestore();
  });
});
