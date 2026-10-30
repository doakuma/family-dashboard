import { describe, expect, it } from "vitest";
import { SWIPE_DEFAULTS, swipeDirection } from "./swipe";

describe("swipeDirection", () => {
  it("왼쪽으로 밀면 다음 달, 오른쪽으로 밀면 이전 달", () => {
    expect(swipeDirection(-120, 5, 200)).toBe("next");
    expect(swipeDirection(120, -5, 200)).toBe("prev");
  });
  it("짧은 움직임(탭 흔들림)은 아니다", () => {
    expect(swipeDirection(-(SWIPE_DEFAULTS.minDistance - 1), 0, 100)).toBeUndefined();
    expect(swipeDirection(-SWIPE_DEFAULTS.minDistance, 0, 100)).toBe("next");
  });
  it("세로가 더 큰 움직임·비스듬한 움직임은 아니다", () => {
    expect(swipeDirection(-80, 100, 200)).toBeUndefined();
    expect(swipeDirection(-100, 80, 200)).toBeUndefined(); // 100 < 80*1.5
    expect(swipeDirection(-120, 80, 200)).toBe("next"); // 120 = 80*1.5
  });
  it("너무 오래 끌면 아니다", () => {
    expect(swipeDirection(-200, 0, SWIPE_DEFAULTS.maxDurationMs + 1)).toBeUndefined();
    expect(swipeDirection(-200, 0, SWIPE_DEFAULTS.maxDurationMs)).toBe("next");
  });
});
