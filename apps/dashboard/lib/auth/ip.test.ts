import { describe, expect, it } from "vitest";
import { PEER_HEADER, isPrivateIp, stampPeer } from "./ip";

describe("isPrivateIp 허용", () => {
  it.each([
    "127.0.0.1", "127.255.255.255", "10.0.0.0", "10.255.255.255", "172.16.0.0", "172.31.255.255", "192.168.0.1", "192.168.255.255",
    "::1", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456::1", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fe80::1", "fe80::1%eth0", "febf::1",
    "::ffff:192.168.0.10", "::ffff:127.0.0.1", "::ffff:c0a8:000a", "::FFFF:10.1.2.3", "0:0:0:0:0:ffff:172.16.0.1",
  ])("%s", (ip) => expect(isPrivateIp(ip)).toBe(true));
});

describe("isPrivateIp 거부 (경계값 포함)", () => {
  it.each([
    "126.255.255.255", "128.0.0.1", "9.255.255.255", "11.0.0.0", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0",
    "8.8.8.8", "169.254.1.1", "100.64.0.1", "0.0.0.0",
    "::", "2001:4860:4860::8888", "fbff::1", "fe00::1", "fec0::1", "ff02::1",
    "::ffff:8.8.8.8", "::ffff:172.32.0.1", "::ffff:808:808", "::192.168.0.1", "64:ff9b::192.168.0.1",
  ])("%s", (ip) => expect(isPrivateIp(ip)).toBe(false));

  it("비었거나 해석할 수 없는 값은 거부", () => {
    for (const bad of [undefined, null, "", "unknown", "192.168.0", "192.168.0.256", "192.168.0.1.5", "010.0.0.1", "192.168.01.1", "1::2::3", "::g", "12345::1", "192.168.0.1, 8.8.8.8", " 192.168.0.1", "192.168.0.1:80", "[::1]"]) {
      expect(isPrivateIp(bad as string | undefined)).toBe(false);
    }
  });
});

describe("stampPeer (custom server)", () => {
  it("밖에서 보낸 PEER 헤더는 지우고 소켓 주소로 덮어쓴다", () => {
    const h: Record<string, string | undefined> = { [PEER_HEADER]: "8.8.8.8", "x-forwarded-for": "8.8.8.8" };
    expect(stampPeer(h, "192.168.0.7")).toBe(true);
    expect(h[PEER_HEADER]).toBe("192.168.0.7");
    expect(h["x-forwarded-for"]).toBe("8.8.8.8"); // 건드리지 않지만 아무도 믿지 않는다
  });
  it("소켓 주소가 내부망이 아니면 거부하고, 위조 헤더도 남기지 않는다", () => {
    const h: Record<string, string | undefined> = { [PEER_HEADER]: "192.168.0.7", "x-forwarded-for": "192.168.0.7" };
    expect(stampPeer(h, "203.0.113.9")).toBe(false);
    expect(h[PEER_HEADER]).toBeUndefined();
    expect(stampPeer({}, undefined)).toBe(false);
  });
});
