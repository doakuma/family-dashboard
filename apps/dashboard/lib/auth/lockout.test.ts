import { describe, expect, it } from "vitest";
import { createLockout } from "./lockout";

describe("PIN 시도 잠금", () => {
  const make = () => {
    let t = 1_000_000;
    const l = createLockout({ maxFailures: 5, lockMs: 10 * 60_000, now: () => t });
    return { l, advance: (ms: number) => (t += ms) };
  };

  it("4번 실패까지는 안 잠기고 5번째에 잠긴다", () => {
    const { l } = make();
    for (let i = 0; i < 4; i++) l.fail();
    expect(l.check().locked).toBe(false);
    l.fail();
    expect(l.check()).toEqual({ locked: true, retryAfterMs: 10 * 60_000 });
  });
  it("성공하면 실패 횟수가 초기화", () => {
    const { l } = make();
    for (let i = 0; i < 4; i++) l.fail();
    l.success();
    for (let i = 0; i < 4; i++) l.fail();
    expect(l.check().locked).toBe(false);
  });
  it("잠금 시간이 지나면 풀리고 다시 5번을 센다", () => {
    const { l, advance } = make();
    for (let i = 0; i < 5; i++) l.fail();
    advance(10 * 60_000 - 1);
    expect(l.check()).toMatchObject({ locked: true, retryAfterMs: 1 });
    advance(1);
    expect(l.check().locked).toBe(false);
    for (let i = 0; i < 4; i++) l.fail();
    expect(l.check().locked).toBe(false);
  });
  it("잠긴 동안의 실패는 잠금 시간을 늘리지 않는다", () => {
    const { l, advance } = make();
    for (let i = 0; i < 5; i++) l.fail();
    advance(5 * 60_000);
    l.fail();
    expect(l.check()).toMatchObject({ locked: true, retryAfterMs: 5 * 60_000 });
  });

  describe("반복될수록 잠금이 2배로 늘어난다", () => {
    const lockOnce = (l: ReturnType<typeof make>["l"]) => {
      for (let i = 0; i < 5; i++) l.fail();
      const c = l.check();
      return c.locked ? c.retryAfterMs : 0;
    };
    const min = 60_000;

    it("15분 -> 30분 -> 60분 -> 120분", () => {
      let t = 0;
      const l = createLockout({ now: () => t });
      const seen: number[] = [];
      for (let i = 0; i < 4; i++) {
        seen.push(lockOnce(l) / min);
        t += seen.at(-1)! * min; // 잠금이 끝날 때까지 기다린다
      }
      expect(seen).toEqual([15, 30, 60, 120]);
    });

    it("상한(24시간)을 넘지 않는다", () => {
      let t = 0;
      const l = createLockout({ now: () => t });
      let last = 0;
      for (let i = 0; i < 12; i++) {
        last = lockOnce(l);
        t += last;
      }
      expect(last).toBe(24 * 60 * min);
    });

    it("PIN이 맞으면 단계가 초기화되어 다시 15분부터", () => {
      let t = 0;
      const l = createLockout({ now: () => t });
      t += lockOnce(l);
      t += lockOnce(l);
      l.success();
      expect(lockOnce(l)).toBe(15 * min);
    });

    it("잠금이 풀린 뒤 4번 실패하고 쉬어도 단계는 유지된다(성공해야 초기화)", () => {
      let t = 0;
      const l = createLockout({ now: () => t });
      t += lockOnce(l);
      for (let i = 0; i < 4; i++) l.fail();
      l.fail();
      expect(l.check()).toMatchObject({ locked: true, retryAfterMs: 30 * min });
    });
  });
});
