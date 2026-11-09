import { describe, expect, it } from "vitest";
import { parseColorCommand } from "./parse";

describe("parseColorCommand: 정탐", () => {
  it.each([
    ["하늘이 색 초록으로 바꿔줘", "하늘이", "green", true],
    ["하늘이 색을 초록으로 바꿔줘", "하늘이", "green", true],
    ["하늘이 색깔을 파랑으로 바꿔주세요", "하늘이", "blue", true],
    ["하늘 색 초록으로 바꿔", "하늘", "green", true],
    ["엄마 색깔 산호로 바꿔줘", "엄마", "coral", true],
    ["엄마의 색 보라로 좀 바꿔줘", "엄마의", "purple", true],
    ["아빠 색 노란색으로 바꿔줘!", "아빠", "amber", true],
    ["하늘 색 green으로 바꿔줘", "하늘", "green", true],
    ["하늘 색을 초록색으로 바꿔줄래", "하늘", "green", true],
    ["  하늘이   색   초록으로   바꿔줘  ", "하늘이", "green", true],
    ["@U0SKY 색 청록으로 바꿔줘", "@U0SKY", "teal", true],
    ["하늘 색 초록", "하늘", "green", false],
    ["하늘이 색깔: 분홍", "하늘이", "pink", false],
    ["하늘 색 Purple", "하늘", "purple", false],
  ])("%s", (text, target, color, explicit) => {
    expect(parseColorCommand(text)).toMatchObject({ target, color, explicit });
  });

  it("모르는 색도 'X로 바꿔' 꼴이면 명령으로 보고 color 없이 낱말을 돌려준다", () => {
    expect(parseColorCommand("하늘이 색 빨강으로 바꿔줘")).toEqual({ target: "하늘이", colorWord: "빨강", color: undefined, explicit: true });
    expect(parseColorCommand("하늘이 색 회색으로 바꿔줘")).toMatchObject({ colorWord: "회색", color: undefined });
  });
});

describe("parseColorCommand: 오탐 방지 (가로채지 않음)", () => {
  it.each([
    "하늘이 색종이 사야 돼",
    "초록색 크레파스 사기",
    "하늘이 색 종이 사야 돼",
    "하늘이 색연필 사줘",
    "다음 주 화요일 3시 하늘 치과",
    "오늘 하늘 색이 예쁘다",
    "벽 색을 바꿔줘",
    "하늘이 초록으로 바꿔줘",
    "초록색으로 바꿔줘",
    "하늘이 색 뭐야?",
    "하늘 색 종이 초록 사기",
    "하늘이 색 종이",
    "우리 하늘이 색 초록 크레파스 사기",
    "연결 482913",
    "색",
    "",
  ])("%s", (text) => {
    expect(parseColorCommand(text)).toBeUndefined();
  });

  it("너무 긴 글은 보지 않는다", () => {
    expect(parseColorCommand(`${"하".repeat(130)} 색 초록으로 바꿔줘`)).toBeUndefined();
  });
});
