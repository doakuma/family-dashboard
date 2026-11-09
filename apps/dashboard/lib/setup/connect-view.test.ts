import { describe, expect, it } from "vitest";
import { announcement, connectView, dmText, pollableCodes } from "./connect-view";

describe("connectView", () => {
  it("코드 없음 / 상태를 모르는 동안은 pending / connected / expired", () => {
    expect(connectView(undefined, "connected")).toEqual({ kind: "none" });
    expect(connectView("123456", undefined)).toEqual({ kind: "pending", code: "123456" });
    expect(connectView("123456", "pending")).toEqual({ kind: "pending", code: "123456" });
    expect(connectView("123456", "connected")).toEqual({ kind: "connected", code: "123456" });
    expect(connectView("123456", "expired")).toEqual({ kind: "expired", code: "123456" });
  });
  it("DM 문구", () => expect(dmText("482913")).toBe("연결 482913"));
});

describe("announcement (aria-live)", () => {
  it("연결되면 알리고, 같은 상태·모름으로의 변화는 알리지 않는다", () => {
    expect(announcement("하늘", "pending", "connected")).toBe("하늘 님이 슬랙에 연결됐어요.");
    expect(announcement("하늘", undefined, "connected")).toContain("연결됐어요");
    expect(announcement("하늘", "connected", "connected")).toBeUndefined();
    expect(announcement("하늘", "connected", undefined)).toBeUndefined();
    expect(announcement("하늘", "pending", "expired")).toContain("다시 받아");
    expect(announcement("하늘", undefined, "expired")).toBeUndefined();
  });
});

describe("pollableCodes", () => {
  it("연결됨·만료는 더 묻지 않는다", () => {
    const members = [{ connectCode: "111111" }, { connectCode: "222222" }, { connectCode: "333333" }, {}];
    expect(pollableCodes(members, { "111111": "connected", "222222": "expired" })).toEqual(["333333"]);
    expect(pollableCodes(members, {})).toEqual(["111111", "222222", "333333"]);
    expect(pollableCodes([{}], {})).toEqual([]);
  });
});
