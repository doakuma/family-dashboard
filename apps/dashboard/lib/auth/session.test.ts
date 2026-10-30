import { describe, expect, it } from "vitest";
import { createSessionCodec, sessionCookieOptions } from "./session";

const make = () => {
  let t = 1_000;
  const c = createSessionCodec({ ttlMs: 30_000, now: () => t });
  return { c, advance: (ms: number) => (t += ms) };
};

describe("세션 쿠키", () => {
  it("서명한 값을 읽는다", () => {
    const { c } = make();
    expect(c.verify(c.sign("setup"))).toEqual({ via: "setup", exp: 31_000 });
    expect(c.verify(c.sign("pin"))?.via).toBe("pin");
  });
  it("만료 시각부터 무효", () => {
    const { c, advance } = make();
    const v = c.sign("pin");
    advance(29_999);
    expect(c.verify(v)).toBeDefined();
    advance(1);
    expect(c.verify(v)).toBeUndefined();
  });
  it("내용을 바꾸거나(via 승격·exp 연장) 서명을 떼면 무효", () => {
    const { c } = make();
    const [payload, sig] = c.sign("pin").split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ via: "setup", exp: 9e15 })).toString("base64url");
    expect(c.verify(`${forged}.${sig}`)).toBeUndefined();
    expect(c.verify(payload)).toBeUndefined();
    expect(c.verify(`${payload}.`)).toBeUndefined();
    expect(c.verify(`${payload}.${sig}.x`)).toBeUndefined();
    expect(c.verify(undefined)).toBeUndefined();
    expect(c.verify("")).toBeUndefined();
    expect(c.verify("not a cookie")).toBeUndefined();
  });
  it("다른 비밀키(서버 재시작)로 만든 값은 무효", () => {
    const a = createSessionCodec();
    const b = createSessionCodec();
    expect(b.verify(a.sign("pin"))).toBeUndefined();
  });
  it("쿠키 속성: HttpOnly, SameSite=Strict, 만료", () => {
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: 1800 });
  });
});
