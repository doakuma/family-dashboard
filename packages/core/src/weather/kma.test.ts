import { describe, expect, it } from "vitest";
import { APP_ERROR, FIXTURE_MID_TMFC, FIXTURE_NOW, FIXTURE_TODAY, KEY_ERROR_XML, MID_LAND_OK, MID_TA_OK, NO_DATA, SHORT_OK } from "./__fixtures__/kma-fixtures";
import { KmaError, iconFromWf, mergeWeek, midTmFc, parseEnvelope, parseMidTerm, parseShortTerm, shortBase } from "./kma";

const kst = (s: string) => new Date(`${s}+09:00`);

describe("shortBase (단기 발표 시각, 정각+10분 뒤부터)", () => {
  it.each([
    ["2026-11-09T05:09", "20261109", "0200"],
    ["2026-11-09T05:10", "20261109", "0500"],
    ["2026-11-09T14:30", "20261109", "1400"],
    ["2026-11-09T23:09", "20261109", "2000"],
    ["2026-11-09T23:10", "20261109", "2300"],
    ["2026-11-09T02:10", "20261109", "0200"],
    ["2026-11-09T02:09", "20261108", "2300"],
    ["2026-11-10T00:00", "20261109", "2300"], // 자정
    ["2026-11-01T00:05", "20261031", "2300"], // 월말
    ["2027-01-01T01:00", "20261231", "2300"], // 연말
    ["2024-03-01T00:30", "20240229", "2300"], // 윤일
  ])("%s -> %s %s", (at, d, t) => {
    expect(shortBase(kst(at))).toEqual({ baseDate: d, baseTime: t });
  });
});

describe("midTmFc (중기 발표 시각, 정각+30분 뒤부터)", () => {
  it.each([
    ["2026-11-09T06:29", "202611081800"],
    ["2026-11-09T06:30", "202611090600"],
    ["2026-11-09T18:29", "202611090600"],
    ["2026-11-09T18:30", "202611091800"],
    ["2026-11-09T23:59", "202611091800"],
    ["2026-11-10T00:10", "202611091800"], // 자정
    ["2026-12-01T03:00", "202611301800"], // 월말
    ["2027-01-01T05:00", "202612311800"], // 연말
  ])("%s -> %s", (at, tmFc) => {
    expect(midTmFc(kst(at))).toBe(tmFc);
  });
});

describe("parseEnvelope", () => {
  it("정상: item 배열 / 단일 객체 / 빈 items", () => {
    expect(parseEnvelope(MID_TA_OK)).toHaveLength(1);
    const one = JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: { a: 1 } } } } });
    expect(parseEnvelope(one)).toEqual([{ a: 1 }]);
    expect(parseEnvelope(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: "" } } }))).toEqual([]);
  });
  it("NO_DATA(03)·다른 오류 코드·XML 키 오류·JSON 아님을 구분", () => {
    expect(() => parseEnvelope(NO_DATA)).toThrow(expect.objectContaining({ kind: "no_data" }));
    expect(() => parseEnvelope(APP_ERROR)).toThrow(expect.objectContaining({ kind: "api" }));
    expect(() => parseEnvelope(KEY_ERROR_XML)).toThrow(expect.objectContaining({ kind: "auth", message: expect.stringContaining("SERVICE_KEY_IS_NOT_REGISTERED_ERROR") }));
    expect(() => parseEnvelope("<html>")).toThrow(KmaError);
    expect(() => parseEnvelope("nope")).toThrow(expect.objectContaining({ kind: "format" }));
    expect(() => parseEnvelope("{}")).toThrow(expect.objectContaining({ kind: "format" }));
  });
});

describe("iconFromWf", () => {
  it.each([
    ["맑음", "sunny"],
    ["구름많음", "partly"],
    ["흐림", "cloudy"],
    ["구름많고 비", "rain"],
    ["흐리고 비", "rain"],
    ["흐리고 비/눈", "snow"],
    ["구름많고 눈", "snow"],
    ["구름많고 소나기", "shower"],
    ["흐리고 소나기", "shower"],
  ])("%s -> %s", (wf, icon) => expect(iconFromWf(wf)).toBe(icon));
  it("모르는 문자열은 undefined", () => {
    expect(iconFromWf("우박")).toBeUndefined();
    expect(iconFromWf("")).toBeUndefined();
  });
});

describe("parseShortTerm (예시 응답)", () => {
  const { days } = parseShortTerm(parseEnvelope(SHORT_OK), FIXTURE_TODAY);
  it("오늘: TMN 없으면 TMP 최저, TMX 사용, 낮 SKY 평균", () => {
    expect(days.get("2026-11-09")).toEqual({ date: "2026-11-09", icon: "partly", max: 15, min: 5, pop: 10 });
  });
  it("낮 강수형태가 있으면 강수 아이콘, 강수확률은 최대", () => {
    expect(days.get("2026-11-10")).toEqual({ date: "2026-11-10", icon: "rain", max: 12, min: 7, pop: 70 });
    expect(days.get("2026-11-11")).toMatchObject({ icon: "cloudy", max: 10, min: 3, pop: 30 });
  });
  it("낮 자료가 없는 먼 날(0시 한 칸)은 뺀다", () => {
    expect(days.has("2026-11-12")).toBe(false);
  });
  it("오늘은 낮 자료가 없어도(밤 늦게) 전체 시각으로 만든다", () => {
    const items = [
      { category: "TMP", fcstDate: "20261109", fcstTime: "2200", fcstValue: "6" },
      { category: "SKY", fcstDate: "20261109", fcstTime: "2200", fcstValue: "1" },
      { category: "PTY", fcstDate: "20261109", fcstTime: "2200", fcstValue: "0" },
    ];
    expect(parseShortTerm(items, "2026-11-09").days.get("2026-11-09")).toMatchObject({ icon: "sunny", max: 6, min: 6 });
  });
  it("눈/진눈깨비는 비보다, 비는 소나기보다 우선. 결측 -999는 무시", () => {
    const mk = (pty: string[]) => [
      ...pty.map((v, i) => ({ category: "PTY", fcstDate: "20261109", fcstTime: `${String(9 + i).padStart(2, "0")}00`, fcstValue: v })),
      { category: "SKY", fcstDate: "20261109", fcstTime: "0900", fcstValue: "1" },
      { category: "TMP", fcstDate: "20261109", fcstTime: "0900", fcstValue: "3" },
      { category: "TMP", fcstDate: "20261109", fcstTime: "1000", fcstValue: "-999" },
    ];
    expect(parseShortTerm(mk(["4", "1"]), "2026-11-09").days.get("2026-11-09")?.icon).toBe("rain");
    expect(parseShortTerm(mk(["1", "2"]), "2026-11-09").days.get("2026-11-09")).toMatchObject({ icon: "snow", min: 3, max: 3 });
    expect(parseShortTerm(mk(["4"]), "2026-11-09").days.get("2026-11-09")?.icon).toBe("shower");
  });
  it("기온이 전혀 없는 날은 빠지고 경고", () => {
    const r = parseShortTerm([{ category: "SKY", fcstDate: "20261109", fcstTime: "0900", fcstValue: "1" }], "2026-11-09");
    expect(r.days.size).toBe(0);
    expect(r.warnings).toHaveLength(1);
  });
});

describe("parseMidTerm (예시 응답)", () => {
  const land = parseEnvelope(MID_LAND_OK)[0];
  const ta = parseEnvelope(MID_TA_OK)[0];
  const { days, warnings } = parseMidTerm(land, ta, FIXTURE_MID_TMFC);
  it("n일 뒤는 tmFc 날짜 기준, Am/Pm 중 강수 우선·확률은 큰 값", () => {
    expect(days.get("2026-11-11")).toEqual({ date: "2026-11-11", icon: "cloudy", max: 10, min: 3, pop: 30 }); // n=3
    expect(days.get("2026-11-12")).toEqual({ date: "2026-11-12", icon: "rain", max: 11, min: 4, pop: 60 }); // n=4 Am 구름많음 Pm 비
    expect(days.get("2026-11-13")).toMatchObject({ icon: "snow", pop: 60 }); // n=5 Am 비/눈
    expect(days.get("2026-11-15")).toMatchObject({ icon: "partly", pop: 20 }); // n=7 Am 맑음 Pm 구름많음 -> 오후
  });
  it("8~10일은 Am/Pm 없는 키를 쓴다", () => {
    expect(days.get("2026-11-16")).toMatchObject({ icon: "partly", pop: 20, max: 13, min: 3 });
    expect(days.get("2026-11-18")).toMatchObject({ icon: "shower" });
  });
  it("있는 키만 쓴다 (n=3~5만 있어도 동작, 기온 없는 날은 빠짐)", () => {
    const r = parseMidTerm({ wf3Am: "맑음", wf3Pm: "맑음", wf4Am: "맑음" }, { taMin3: 1, taMax3: 9 }, FIXTURE_MID_TMFC);
    expect([...r.days.keys()]).toEqual(["2026-11-11"]);
  });
  it("모르는 문구는 cloudy + 경고", () => {
    const r = parseMidTerm({ wf3Am: "우박" }, { taMin3: 1, taMax3: 9 }, FIXTURE_MID_TMFC);
    expect(r.days.get("2026-11-11")?.icon).toBe("cloudy");
    expect(r.warnings[0]).toContain("우박");
    expect(warnings).toEqual([]);
  });
  it("육상·기온 중 하나가 없으면 빈 결과", () => {
    expect(parseMidTerm(land, undefined, FIXTURE_MID_TMFC).days.size).toBe(0);
  });
  it("월말·연말 경계: tmFc 12/30 + 3 = 1/2", () => {
    expect([...parseMidTerm({ wf3Am: "맑음" }, { taMin3: 1, taMax3: 2 }, "202612301800").days.keys()]).toEqual(["2027-01-02"]);
  });
});

describe("mergeWeek", () => {
  const s = parseShortTerm(parseEnvelope(SHORT_OK), FIXTURE_TODAY).days;
  const m = parseMidTerm(parseEnvelope(MID_LAND_OK)[0], parseEnvelope(MID_TA_OK)[0], FIXTURE_MID_TMFC).days;
  it("오늘~+6일 7개, 단기 우선, 없으면 중기", () => {
    const w = mergeWeek(FIXTURE_TODAY, s, m);
    expect(w.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(w[2]?.icon).toBe("cloudy"); // 11/11은 단기(중기 n=3도 cloudy지만 기온 3/10 = 단기 값과 같게 지어서 pop으로 구분)
    expect(w[0]?.max).toBe(15);
    expect(w[3]?.icon).toBe("rain"); // 중기
  });
  it("값이 없는 날은 빠진다", () => {
    expect(mergeWeek(FIXTURE_TODAY, s, new Map())).toHaveLength(3);
    expect(mergeWeek(FIXTURE_TODAY, new Map(), new Map())).toEqual([]);
  });
  it("예시 기준 시각은 단기 0500, 중기 직전 18시", () => {
    expect(shortBase(FIXTURE_NOW)).toEqual({ baseDate: "20261109", baseTime: "0500" });
    expect(midTmFc(FIXTURE_NOW)).toBe(FIXTURE_MID_TMFC);
  });
});
