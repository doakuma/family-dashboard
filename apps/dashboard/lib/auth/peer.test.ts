import { describe, expect, it } from "vitest";
import { PEER_HEADER, PEER_PROOF_HEADER, createPeerSecret, peerProof, stampPeer, verifyPeer } from "./peer";

const secret = "s".repeat(64);

describe("stampPeer (custom server)", () => {
  it("밖에서 보낸 PEER·증명 헤더는 지우고 소켓 주소와 증명으로 덮어쓴다", () => {
    const h: Record<string, string | undefined> = { [PEER_HEADER]: "8.8.8.8", [PEER_PROOF_HEADER]: "forged", "x-forwarded-for": "8.8.8.8" };
    expect(stampPeer(h, "192.168.0.7", secret)).toBe(true);
    expect(h[PEER_HEADER]).toBe("192.168.0.7");
    expect(h[PEER_PROOF_HEADER]).toBe(peerProof(secret, "192.168.0.7"));
    expect(h["x-forwarded-for"]).toBe("8.8.8.8"); // 건드리지 않지만 아무도 믿지 않는다
  });
  it("소켓 주소가 내부망이 아니면 거부하고, 위조 헤더도 남기지 않는다", () => {
    const h: Record<string, string | undefined> = { [PEER_HEADER]: "192.168.0.7", [PEER_PROOF_HEADER]: "x" };
    expect(stampPeer(h, "203.0.113.9", secret)).toBe(false);
    expect(h[PEER_HEADER]).toBeUndefined();
    expect(h[PEER_PROOF_HEADER]).toBeUndefined();
    expect(stampPeer({}, undefined, secret)).toBe(false);
  });
});

describe("verifyPeer (proxy)", () => {
  const proof = peerProof(secret, "192.168.0.7");

  it("서버가 붙인 증명이면 통과", () => {
    expect(verifyPeer("192.168.0.7", proof, secret)).toBe(true);
  });
  it("주소만 위조(증명 없음·틀림·다른 주소의 증명)하면 거부", () => {
    expect(verifyPeer("127.0.0.1", null, secret)).toBe(false);
    expect(verifyPeer("127.0.0.1", "deadbeef", secret)).toBe(false);
    expect(verifyPeer("127.0.0.1", proof, secret)).toBe(false);
    expect(verifyPeer("192.168.0.7", proof.slice(0, -1), secret)).toBe(false);
  });
  it("비밀값이 없으면(server.ts를 거치지 않은 next start) 어떤 헤더로도 항상 거부", () => {
    expect(verifyPeer("127.0.0.1", peerProof("", "127.0.0.1"), undefined)).toBe(false);
    expect(verifyPeer("127.0.0.1", peerProof("", "127.0.0.1"), "")).toBe(false);
  });
  it("다른 비밀값으로 만든 증명은 거부", () => {
    expect(verifyPeer("192.168.0.7", peerProof("other", "192.168.0.7"), secret)).toBe(false);
  });
  it("증명이 맞아도 사설 대역이 아니면 거부", () => {
    expect(verifyPeer("8.8.8.8", peerProof(secret, "8.8.8.8"), secret)).toBe(false);
  });
  it("비밀값은 매번 다른 64자 hex", () => {
    expect(createPeerSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(createPeerSecret()).not.toBe(createPeerSecret());
  });
});
