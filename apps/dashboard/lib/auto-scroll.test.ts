import { describe, expect, it } from "vitest";
import { AUTO_SCROLL_DEFAULTS as C, initialCycle, maxScroll, overflows, shouldAutoScroll, stepCycle, type RunInput } from "./auto-scroll";

describe("overflows", () => {
  it("넘칠 때만 true (1px 오차는 무시)", () => {
    expect(overflows({ clientHeight: 100, scrollHeight: 100 })).toBe(false);
    expect(overflows({ clientHeight: 100, scrollHeight: 101 })).toBe(false);
    expect(overflows({ clientHeight: 100, scrollHeight: 102 })).toBe(true);
    expect(maxScroll({ clientHeight: 100, scrollHeight: 340 })).toBe(240);
    expect(maxScroll({ clientHeight: 100, scrollHeight: 50 })).toBe(0);
  });
});

describe("shouldAutoScroll", () => {
  const base: RunInput = { overflows: true, reducedMotion: false, touching: false, now: 1_000_000, resumeAfterTouchMs: C.resumeAfterTouchMs };

  it("넘치고 아무도 안 만졌으면 순환", () => {
    expect(shouldAutoScroll(base)).toBe(true);
  });
  it("안 넘치면 순환하지 않는다", () => {
    expect(shouldAutoScroll({ ...base, overflows: false })).toBe(false);
  });
  it("prefers-reduced-motion이면 순환하지 않는다", () => {
    expect(shouldAutoScroll({ ...base, reducedMotion: true })).toBe(false);
  });
  it("손이 닿아 있는 동안은 멈춘다", () => {
    expect(shouldAutoScroll({ ...base, touching: true })).toBe(false);
  });
  it("손을 뗀 뒤 120초가 지나야 재개한다(정확히 120초부터)", () => {
    expect(C.resumeAfterTouchMs).toBe(120_000);
    const t = base.now;
    expect(shouldAutoScroll({ ...base, lastTouchAt: t - 1_000 })).toBe(false);
    expect(shouldAutoScroll({ ...base, lastTouchAt: t - 119_999 })).toBe(false);
    expect(shouldAutoScroll({ ...base, lastTouchAt: t - 120_000 })).toBe(true);
  });
});

describe("stepCycle: 위 -> 아래 -> 처음, 양 끝에서 잠시 멈춤", () => {
  const max = 100;
  const run = (state = initialCycle(), ms: number, step = 100) => {
    let s = state;
    for (let t = 0; t < ms; t += step) s = stepCycle(s, step, max, C);
    return s;
  };

  it("맨 위에서 holdMs 동안 가만히 있다가 내려간다", () => {
    expect(run(initialCycle(), C.holdMs - 100)).toMatchObject({ phase: "hold-top", pos: 0 });
    expect(run(initialCycle(), C.holdMs)).toMatchObject({ phase: "down", pos: 0 });
    const s = run(initialCycle(), C.holdMs + 1000);
    expect(s.pos).toBeCloseTo(C.speed, 5);
  });

  it("내려가는 속도는 speed px/초이고 소수 위치를 유지한다", () => {
    const s = stepCycle({ phase: "down", elapsed: 0, pos: 10 }, 16, max, C); // 한 프레임
    expect(s.pos).toBeCloseTo(10 + (C.speed * 16) / 1000, 6);
    expect(s.pos % 1).not.toBe(0);
  });

  it("끝에 닿으면 멈췄다가 처음으로 돌아가 한 바퀴를 마친다", () => {
    const atBottom = stepCycle({ phase: "down", elapsed: 0, pos: 99.9 }, 1000, max, C);
    expect(atBottom).toMatchObject({ phase: "hold-bottom", pos: max });
    expect(stepCycle(atBottom, C.holdMs - 1, max, C)).toMatchObject({ phase: "hold-bottom", pos: max });
    expect(stepCycle(atBottom, C.holdMs, max, C)).toMatchObject({ phase: "hold-top", pos: 0 });
  });

  it("한 바퀴를 돌리면 제자리로 돌아온다", () => {
    const total = C.holdMs * 2 + (max / C.speed) * 1000 + 200;
    const s = run(initialCycle(), total, 50);
    expect(["hold-top", "down"]).toContain(s.phase);
    expect(s.pos).toBeLessThan(max);
  });

  it("손으로 옮긴 위치에서 이어간다 / 영역이 줄어 max가 바뀌어도 범위를 벗어나지 않는다", () => {
    expect(initialCycle(40)).toMatchObject({ phase: "down", pos: 40 });
    expect(stepCycle({ phase: "down", elapsed: 0, pos: 500 }, 16, 100, C).pos).toBe(100);
    expect(stepCycle({ phase: "down", elapsed: 0, pos: 30 }, 16, 0, C)).toEqual(initialCycle());
  });
});
