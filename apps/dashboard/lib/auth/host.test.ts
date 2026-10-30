import { describe, expect, it } from "vitest";
import { isAllowedHost, isAllowedOrigin, parseHostHeader } from "./host";

const prod = { NODE_ENV: "production", DASHBOARD_BASE_URL: "http://hsh.lan:3000" };

describe("parseHostHeader", () => {
  it("이름·IPv4·IPv6, 포트 유무", () => {
    expect(parseHostHeader("Hsh.LAN:3000")).toEqual({ hostname: "hsh.lan", port: "3000" });
    expect(parseHostHeader("192.168.0.5")).toEqual({ hostname: "192.168.0.5", port: undefined });
    expect(parseHostHeader("[::1]:3000")).toEqual({ hostname: "::1", port: "3000" });
  });
  it("비었거나 이상한 값은 undefined", () => {
    for (const v of [undefined, null, "", "a b", "evil.com/x", "user@evil.com", "a:b", "a:123456"]) expect(parseHostHeader(v), String(v)).toBeUndefined();
  });
});

describe("isAllowedHost", () => {
  it("BASE_URL의 host(포트 포함), localhost 계열, 사설 IP 리터럴을 허용", () => {
    for (const h of ["hsh.lan:3000", "HSH.LAN:3000", "localhost:3000", "localhost", "127.0.0.1:3217", "[::1]:3000", "192.168.0.5:3000", "10.1.2.3", "172.20.0.1:80", "[fd00::5]:3000"]) {
      expect(isAllowedHost(h, prod), h).toBe(true);
    }
  });
  it("그 밖의 도메인(리바인딩 공격자), 공인 IP, 포트가 다른 BASE host는 403 대상", () => {
    for (const h of ["evil.example", "evil.example:3000", "hsh.lan:4000", "hsh.lan", "hsh.lan.evil.example:3000", "8.8.8.8:3000", "[2001:db8::1]:3000", "", undefined]) {
      expect(isAllowedHost(h, prod), String(h)).toBe(false);
    }
  });
  it("BASE_URL이 없으면 localhost·사설 IP만", () => {
    const env = { NODE_ENV: "production" };
    expect(isAllowedHost("hsh.lan:3000", env)).toBe(false);
    expect(isAllowedHost("192.168.0.5:3000", env)).toBe(true);
  });
  it("BASE_URL 기본 포트는 생략과 같다", () => {
    expect(isAllowedHost("hsh.lan", { DASHBOARD_BASE_URL: "http://hsh.lan" })).toBe(true);
    expect(isAllowedHost("hsh.lan:80", { DASHBOARD_BASE_URL: "http://hsh.lan" })).toBe(true);
    expect(isAllowedHost("hsh.lan", { DASHBOARD_BASE_URL: "https://hsh.lan" })).toBe(true); // 헤더에 포트가 없으면 BASE_URL 스킴의 기본 포트
    expect(isAllowedHost("hsh.lan:80", { DASHBOARD_BASE_URL: "https://hsh.lan" })).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("BASE_URL의 origin과 같을 때만 허용 (Host 헤더와 무관)", () => {
    expect(isAllowedOrigin("http://hsh.lan:3000", prod)).toBe(true);
    expect(isAllowedOrigin("http://hsh.lan:3000/setup?t=x", prod)).toBe(true); // Referer
    expect(isAllowedOrigin("http://evil.example:3000", prod)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000", prod)).toBe(false); // 운영에서는 localhost 추가 없음
    expect(isAllowedOrigin("null", prod)).toBe(false);
    expect(isAllowedOrigin(null, prod)).toBe(false);
  });
  it("개발 모드에서는 localhost:PORT도 허용", () => {
    const dev = { NODE_ENV: "development", PORT: "3100" };
    expect(isAllowedOrigin("http://localhost:3100", dev)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3100", dev)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", dev)).toBe(false);
  });
  it("운영에서 BASE_URL이 없으면 모두 거부(닫는 쪽으로 실패)", () => {
    expect(isAllowedOrigin("http://localhost:3000", { NODE_ENV: "production" })).toBe(false);
  });
});
