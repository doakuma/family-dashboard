// 기상청 API 응답 형식 예시. 숫자·날씨 값은 전부 지어낸 값이다(실제 예보 아님). README.md 참고.
// 기준: 2026-11-09(월) 05:30 서울 -> 단기 base 20261109 0500, 중기 tmFc 202611090600 은 아직 발표 전이라 202611081800.

export const FIXTURE_NOW = new Date("2026-11-08T20:30:00Z"); // 서울 2026-11-09 05:30
export const FIXTURE_TODAY = "2026-11-09";
export const FIXTURE_MID_TMFC = "202611081800";

const envelope = (items: unknown[]) =>
  JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { dataType: "JSON", items: { item: items }, pageNo: 1, numOfRows: 1500, totalCount: items.length } } });

/** 단기예보 항목 하나(공식 필드 이름 그대로) */
const sItem = (fcstDate: string, fcstTime: string, category: string, fcstValue: string) => ({ baseDate: "20261109", baseTime: "0500", category, fcstDate, fcstTime, fcstValue, nx: 60, ny: 127 });

function shortItems() {
  const out: ReturnType<typeof sItem>[] = [];
  // 11/09 06~23시: 맑다가 오후부터 구름 (TMN 없음 = 0500 발표엔 오늘 최저가 없다고 보고 TMX만)
  // 11/10: 낮에 비 / 11/11: 흐림, 비 없음 / 11/12 0시 한 칸(낮 자료 없음 -> 단기에서 빠져야 함)
  const days: { d: string; from: number; to: number; sky: (h: number) => string; pty: (h: number) => string; pop: (h: number) => string; tmp: (h: number) => number }[] = [
    { d: "20261109", from: 6, to: 23, sky: (h) => (h < 13 ? "1" : "3"), pty: () => "0", pop: (h) => (h < 13 ? "0" : "10"), tmp: (h) => 5 + Math.round(10 * Math.sin(((h - 6) / 18) * Math.PI)) },
    { d: "20261110", from: 0, to: 23, sky: () => "4", pty: (h) => (h >= 10 && h <= 17 ? "1" : "0"), pop: (h) => (h >= 10 && h <= 17 ? "70" : "20"), tmp: (h) => 8 + Math.round(4 * Math.sin(((h - 6) / 18) * Math.PI)) },
    { d: "20261111", from: 0, to: 23, sky: () => "4", pty: () => "0", pop: () => "30", tmp: (h) => 4 + Math.round(6 * Math.sin(((h - 6) / 18) * Math.PI)) },
  ];
  for (const day of days) {
    for (let h = day.from; h <= day.to; h++) {
      const t = `${String(h).padStart(2, "0")}00`;
      out.push(sItem(day.d, t, "TMP", String(day.tmp(h))));
      out.push(sItem(day.d, t, "UUU", "1.2"), sItem(day.d, t, "VVV", "-0.5"), sItem(day.d, t, "VEC", "250"), sItem(day.d, t, "WSD", "1.3"));
      out.push(sItem(day.d, t, "SKY", day.sky(h)), sItem(day.d, t, "PTY", day.pty(h)), sItem(day.d, t, "POP", day.pop(h)));
      out.push(sItem(day.d, t, "WAV", "0"), sItem(day.d, t, "PCP", day.pty(h) === "0" ? "강수없음" : "1.0mm"), sItem(day.d, t, "REH", "60"), sItem(day.d, t, "SNO", "적설없음"));
    }
  }
  out.push(sItem("20261109", "1500", "TMX", "15.0"));
  out.push(sItem("20261110", "0600", "TMN", "7.0"), sItem("20261110", "1500", "TMX", "12.0"));
  out.push(sItem("20261111", "0600", "TMN", "3.0"), sItem("20261111", "1500", "TMX", "10.0"));
  // 11/12 0시 한 칸
  out.push(sItem("20261112", "0000", "TMP", "4"), sItem("20261112", "0000", "SKY", "4"), sItem("20261112", "0000", "PTY", "0"), sItem("20261112", "0000", "POP", "30"));
  return out;
}

/** getVilageFcst */
export const SHORT_OK = envelope(shortItems());

const mid = (o: Record<string, unknown>) => envelope([o]);

/** getMidLandFcst (서울·인천·경기). n일 뒤는 tmFc 날짜(11/08) 기준: 3 = 11/11 ... 7 = 11/15, 8~10은 Am/Pm 없음 */
export const MID_LAND_OK = mid({
  regId: "11B00000",
  rnSt3Am: 30, rnSt3Pm: 30, rnSt4Am: 20, rnSt4Pm: 60, rnSt5Am: 60, rnSt5Pm: 30, rnSt6Am: 10, rnSt6Pm: 10, rnSt7Am: 0, rnSt7Pm: 20, rnSt8: 20, rnSt9: 30, rnSt10: 30,
  rnYn3Am: 0, rnYn3Pm: 0,
  wf3Am: "흐림", wf3Pm: "흐림", wf4Am: "구름많음", wf4Pm: "흐리고 비", wf5Am: "흐리고 비/눈", wf5Pm: "구름많음", wf6Am: "맑음", wf6Pm: "맑음", wf7Am: "맑음", wf7Pm: "구름많음", wf8: "구름많음", wf9: "흐림", wf10: "구름많고 소나기",
});

/** getMidTa (서울) */
export const MID_TA_OK = mid({
  regId: "11B10101",
  taMin3: 3, taMin3Low: 2, taMin3High: 1, taMax3: 10, taMax3Low: 1, taMax3High: 2,
  taMin4: 4, taMax4: 11, taMin5: 2, taMax5: 8, taMin6: 1, taMax6: 9, taMin7: 2, taMax7: 12, taMin8: 3, taMax8: 13, taMin9: 4, taMax9: 12, taMin10: 3, taMax10: 11,
});

/** 발표 전/자료 없음: 공식 응답은 body 없이 header만 온다 */
export const NO_DATA = JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } });

/** 서비스 오류(JSON): 예) 파라미터 오류 */
export const APP_ERROR = JSON.stringify({ response: { header: { resultCode: "10", resultMsg: "INVALID_REQUEST_PARAMETER_ERROR" } } });

/** 인증키 오류: dataType=JSON이어도 이렇게 XML로 온다 */
export const KEY_ERROR_XML = `<OpenAPI_ServiceResponse>
\t<cmmMsgHeader>
\t\t<errMsg>SERVICE ERROR</errMsg>
\t\t<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>
\t\t<returnReasonCode>30</returnReasonCode>
\t</cmmMsgHeader>
</OpenAPI_ServiceResponse>`;
