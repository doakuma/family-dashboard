import { describe, expect, it } from "vitest";
import { hashPin, isValidPinFormat, verifyPin } from "./pin";

describe("PIN 형식", () => {
  it("숫자 4~6자리만", () => {
    for (const ok of ["1234", "12345", "123456", "0000"]) expect(isValidPinFormat(ok)).toBe(true);
    for (const bad of ["", "123", "1234567", "12a4", " 1234", "１２３４", "12.4", "1234\n"]) expect(isValidPinFormat(bad)).toBe(false);
  });
  it("형식이 틀리면 해시를 만들지 않는다", () => {
    expect(() => hashPin("12")).toThrow();
  });
});

describe("PIN 해시", () => {
  const stored = hashPin("4821");

  it("맞는 PIN만 통과", () => {
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4822", stored)).toBe(false);
    expect(verifyPin("482", stored)).toBe(false);
  });
  it("salt가 랜덤이라 같은 PIN도 해시가 다르다", () => {
    expect(hashPin("4821")).not.toBe(stored);
  });
  it("PIN 원문이 해시에 들어 있지 않고, .env에서 치환되는 `$`가 없다", () => {
    expect(stored).not.toContain("4821");
    expect(stored).not.toContain("$");
    expect(stored).not.toMatch(/\s/);
  });
  it("값이 없거나 망가졌으면 예외 없이 false", () => {
    for (const bad of [undefined, "", "abc", "scrypt:1:2", "bcrypt:16384:8:1:aaaaaaaaaaaa:bbbb", "scrypt:16384:8:1::", "scrypt:x:8:1:aaaaaaaaaaaa:bbbb"]) {
      expect(verifyPin("4821", bad)).toBe(false);
    }
  });
  it("비정상적으로 큰 비용 값은 계산하지 않고 거부", () => {
    const [, , r, p, salt, hash] = stored.split(":");
    expect(verifyPin("4821", ["scrypt", 1 << 30, r, p, salt, hash].join(":"))).toBe(false);
    expect(verifyPin("4821", ["scrypt", 16385, r, p, salt, hash].join(":"))).toBe(false); // 2의 거듭제곱 아님
  });
  it("앞뒤 공백·줄바꿈이 붙은 저장값도 읽는다 (.env 편집 실수)", () => {
    expect(verifyPin("4821", `${stored}\n`)).toBe(true);
  });
});
