import { describe, expect, it } from "vitest";
import { MEMBER_COLORS } from "../palette";
import { PICKABLE_COLORS, suggestColor } from "./colors";

describe("suggestColor", () => {
  it("아무도 안 썼으면 첫 색", () => {
    expect(suggestColor([])).toBe("coral");
  });
  it("쓰인 색을 건너뛰고 순서대로 겹치지 않게 추천", () => {
    expect(suggestColor(["coral"])).toBe("teal");
    expect(suggestColor(["coral", "blue"])).toBe("teal");
    expect(suggestColor(["coral", "teal", "blue"])).toBe("amber");
  });
  it("연속으로 추천하면 서로 다른 색이 7개까지 나온다", () => {
    const used: string[] = [];
    for (let i = 0; i < PICKABLE_COLORS.length; i++) used.push(suggestColor(used));
    expect(new Set(used).size).toBe(PICKABLE_COLORS.length);
  });
  it("모두 쓰였으면 가장 적게 쓰인 색부터 다시 (동률이면 앞선 색)", () => {
    const all = [...PICKABLE_COLORS];
    expect(suggestColor(all)).toBe("coral");
    expect(suggestColor([...all, "coral"])).toBe("teal");
    expect(suggestColor([...all, "coral", "teal"])).toBe("blue");
  });
  it("후보는 모두 팔레트에 있고 gray(가족 전체)는 아니다", () => {
    for (const c of PICKABLE_COLORS) expect(c in MEMBER_COLORS).toBe(true);
    expect(PICKABLE_COLORS).not.toContain("gray");
  });
});
