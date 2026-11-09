import { describe, expect, it } from "vitest";
import { COLOR_LABELS, PICKABLE_COLORS, colorLabel, parseColorName } from "./member-colors";

describe("parseColorName", () => {
  it("한국어 견본 이름·영문 이름(대소문자 무시)·'색' 접미", () => {
    expect(parseColorName("초록")).toBe("green");
    expect(parseColorName("초록색")).toBe("green");
    expect(parseColorName("Green")).toBe("green");
    expect(parseColorName(" 파랑 ")).toBe("blue");
    for (const c of PICKABLE_COLORS) {
      expect(parseColorName(COLOR_LABELS[c])).toBe(c);
      expect(parseColorName(c)).toBe(c);
    }
  });
  it("흔한 다른 표기", () => {
    expect(parseColorName("노랑")).toBe("amber");
    expect(parseColorName("녹색")).toBe("green");
  });
  it("모르는 말·gray·빈 값은 undefined", () => {
    for (const t of ["", "색", "빨강", "gray", "회색", "하늘", "#ff0000", "크레파스"]) expect(parseColorName(t), t).toBeUndefined();
  });
});

describe("colorLabel", () => {
  it("목록 밖 값은 그대로", () => {
    expect(colorLabel("blue")).toBe("파랑");
    expect(colorLabel("gray")).toBe("gray");
  });
});
