import { describe, expect, it } from "vitest";
import { createSetupTokenStore } from "./setup-token";

const MIN = 60_000;
const make = () => {
  let t = 0;
  const s = createSetupTokenStore({ ttlMs: 30 * MIN, refreshMarginMs: 5 * MIN, now: () => t });
  return { s, advance: (ms: number) => (t += ms) };
};

describe("세팅 토큰", () => {
  it("발급한 토큰은 유효하고 엉뚱한 값은 아니다", () => {
    const { s } = make();
    const t = s.current();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(s.isValid(t)).toBe(true);
    expect(s.isValid(t + "x")).toBe(false);
    expect(s.isValid("")).toBe(false);
    expect(s.isValid(undefined)).toBe(false);
  });
  it("만료 직전까지 유효, 만료 시각에 무효", () => {
    const { s, advance } = make();
    const t = s.current();
    advance(30 * MIN - 1);
    expect(s.isValid(t)).toBe(true);
    advance(1);
    expect(s.isValid(t)).toBe(false);
    expect(s.consume(t)).toBe(false);
  });
  it("한 번 쓰면 폐기되고 두 번째는 실패", () => {
    const { s } = make();
    const t = s.current();
    expect(s.consume(t)).toBe(true);
    expect(s.consume(t)).toBe(false);
    expect(s.isValid(t)).toBe(false);
  });
  it("쓴 뒤에는 다른 토큰으로 재발급", () => {
    const { s } = make();
    const a = s.current();
    s.consume(a);
    const b = s.current();
    expect(b).not.toBe(a);
    expect(s.isValid(b)).toBe(true);
  });
  it("여유가 충분하면 같은 토큰을 돌려주고, 5분 안쪽으로 남으면 새로 발급하되 옛 토큰도 자기 만료까지 유효", () => {
    const { s, advance } = make();
    const a = s.current();
    advance(25 * MIN - 1);
    expect(s.current()).toBe(a);
    advance(1);
    const b = s.current();
    expect(b).not.toBe(a);
    expect(s.isValid(a)).toBe(true);
    expect(s.isValid(b)).toBe(true);
    advance(5 * MIN);
    expect(s.isValid(a)).toBe(false);
    expect(s.isValid(b)).toBe(true);
  });
  it("하나를 쓰면 같이 나간 다른 토큰도 모두 폐기", () => {
    const { s, advance } = make();
    const a = s.current();
    advance(26 * MIN);
    const b = s.current();
    expect(s.consume(b)).toBe(true);
    expect(s.isValid(a)).toBe(false);
  });
  it("revokeAll: 발급된 모든 토큰이 무효가 되고 다음 current()는 새 토큰", () => {
    const { s } = make();
    const a = s.current();
    const b = s.current();
    expect(b).toBe(a);
    s.revokeAll();
    expect(s.isValid(a)).toBe(false);
    expect(s.current()).not.toBe(a);
  });
});
