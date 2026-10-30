import { describe, expect, it } from "vitest";
import { parseCompleteResponse } from "./response";

describe("parseCompleteResponse", () => {
  it("성공·실패 모양을 읽는다", () => {
    expect(parseCompleteResponse({ ok: true, commit: "abc", pushed: false, pushError: "x" })).toEqual({ ok: true, pushed: false, pushError: "x" });
    expect(parseCompleteResponse({ ok: false, code: "invalid", message: "m", issues: [{ path: "a", message: "b" }] })).toMatchObject({ ok: false, code: "invalid" });
  });
  it("모양이 다르면 undefined", () => {
    for (const raw of [null, "x", [], {}, { ok: true }, { ok: true, pushed: "no" }, { ok: false, issues: [{ path: 1 }] }, { ok: false, message: 3 }]) expect(parseCompleteResponse(raw), JSON.stringify(raw)).toBeUndefined();
  });
});
