import { describe, expect, it } from "vitest";
import { generateConnectCode, isConnectCode, isExpired, parseConnectMessage, toHalfWidthDigits } from "./connect-code";

describe("parseConnectMessage", () => {
  it.each([
    ["연결 482913", "482913"],
    ["연결482913", "482913"],
    ["  연결   482913  ", "482913"],
    ["연결: 482913", "482913"],
    ["연결 ４８２９１３", "482913"], // 전각 숫자
    ["연결　482913", "482913"], // 전각 공백
    ["연결 000123", "000123"],
    ["연결 482913 이거 맞아?", "482913"],
    ["이거 연결 482913", "482913"],
  ])("%s -> %s", (text, code) => expect(parseConnectMessage(text)).toBe(code));

  it.each(["연결", "연결 12345", "연결 1234567", "연결 abc123", "482913", "연결 48 2913", "연결해 줘 482913", ""])("코드가 아닌 글: %j", (text) => expect(parseConnectMessage(text)).toBeUndefined());
});

describe("코드 형식·유틸", () => {
  it("6자리 숫자만", () => {
    expect(isConnectCode("012345")).toBe(true);
    for (const v of ["12345", "1234567", "12345a", "", " 123456", 123456, undefined, "１２３４５６"]) expect(isConnectCode(v), String(v)).toBe(false);
  });
  it("전각 숫자 변환", () => expect(toHalfWidthDigits("０９ab")).toBe("09ab"));
  it("generateConnectCode: 0 채움, 쓰는 코드와 겹치면 다시 뽑고, 계속 실패하면 undefined", () => {
    expect(generateConnectCode(() => 42, new Set())).toBe("000042");
    const seq = [7, 7, 8];
    expect(generateConnectCode(() => seq.shift() ?? 9, new Set(["000007"]))).toBe("000008");
    expect(generateConnectCode(() => 1, new Set(["000001"]), 5)).toBeUndefined();
  });
  it("isExpired: 만료 시각 정각부터 만료", () => {
    const t = new Date("2026-11-09T00:00:00Z");
    expect(isExpired("2026-11-09T00:00:01Z", t)).toBe(false);
    expect(isExpired("2026-11-09T00:00:00Z", t)).toBe(true);
    expect(isExpired("garbage", t)).toBe(true);
  });
});
