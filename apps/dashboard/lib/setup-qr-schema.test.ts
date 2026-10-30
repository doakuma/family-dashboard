import { describe, expect, it } from "vitest";
import { setupQrSchema } from "./setup-qr-schema";

describe("setupQrSchema", () => {
  it("정상 응답", () => {
    expect(setupQrSchema.safeParse({ ok: true, label: "http://a/setup", url: "http://a/setup?t=x", svg: '<svg xmlns="..."></svg>' }).success).toBe(true);
    expect(setupQrSchema.safeParse({ ok: false, reason: "missing" }).success).toBe(true);
  });
  it("svg가 <svg로 시작하지 않거나 모양이 다르면 거부", () => {
    const base = { ok: true, label: "l", url: "u" };
    expect(setupQrSchema.safeParse({ ...base, svg: "<img src=x onerror=alert(1)>" }).success).toBe(false);
    expect(setupQrSchema.safeParse({ ...base, svg: " <svg></svg>" }).success).toBe(false);
    expect(setupQrSchema.safeParse({ ...base }).success).toBe(false);
    expect(setupQrSchema.safeParse({ ok: false, reason: "other" }).success).toBe(false);
    expect(setupQrSchema.safeParse(null).success).toBe(false);
    expect(setupQrSchema.safeParse("<svg>").success).toBe(false);
  });
});
