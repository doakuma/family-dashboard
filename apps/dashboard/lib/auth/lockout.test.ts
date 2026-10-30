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
});
