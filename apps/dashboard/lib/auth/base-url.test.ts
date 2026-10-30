import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "./base-url";

describe("QR 기준 주소", () => {
  it("DASHBOARD_BASE_URL이 있으면 그 origin", () => {
    expect(resolveBaseUrl({ dashboardBaseUrl: "http://192.168.0.20:3000/", nodeEnv: "production" })).toEqual({ ok: true, url: "http://192.168.0.20:3000" });
    expect(resolveBaseUrl({ dashboardBaseUrl: "http://home.local:3000/x/y" })).toEqual({ ok: true, url: "http://home.local:3000" });
  });
  it("없으면 개발 모드에서만 localhost", () => {
    expect(resolveBaseUrl({ nodeEnv: "development", port: 3100 })).toEqual({ ok: true, url: "http://localhost:3100" });
    expect(resolveBaseUrl({})).toEqual({ ok: true, url: "http://localhost:3000" });
    expect(resolveBaseUrl({ nodeEnv: "production" })).toEqual({ ok: false, reason: "missing" });
    expect(resolveBaseUrl({ nodeEnv: "production", dashboardBaseUrl: "  " })).toEqual({ ok: false, reason: "missing" });
  });
  it("http(s) 주소가 아니면 거부", () => {
    expect(resolveBaseUrl({ dashboardBaseUrl: "javascript:alert(1)" })).toEqual({ ok: false, reason: "invalid" });
    expect(resolveBaseUrl({ dashboardBaseUrl: "192.168.0.20:3000" })).toEqual({ ok: false, reason: "invalid" });
    expect(resolveBaseUrl({ dashboardBaseUrl: "nonsense" })).toEqual({ ok: false, reason: "invalid" });
  });
});
