import { describe, expect, it } from "vitest";
import { parsePreview } from "./preview";

const q = { at: "2026-11-03T12:00:00+09:00", mode: "night", skin: "paper" };

describe("미리보기 쿼리", () => {
  it("켜져 있으면 알려진 값만 받는다", () => {
    expect(parsePreview(q, true)).toEqual({ at: q.at, mode: "night", skin: "paper" });
    expect(parsePreview({ at: "nope", mode: "x", skin: "neon" }, true)).toEqual({ at: undefined, mode: undefined, skin: undefined });
  });
  it("꺼져 있으면(운영) 전부 무시한다", () => {
    expect(parsePreview(q, false)).toEqual({});
  });
});
