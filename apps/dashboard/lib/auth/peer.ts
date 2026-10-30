// 주의: server.ts가 Node로 직접 불러오는 파일이라 상대 import에는 .ts 확장자를 붙인다.
// server.ts가 소켓 주소를 proxy.ts에 넘기는 방법. (결정 기록 0002)
// 헤더 값만 믿으면 `next start`로 직접 띄웠을 때 클라이언트가 `x-hsh-peer: 127.0.0.1`을 위조할 수 있다.
// 그래서 server.ts가 시작할 때 만든 랜덤 비밀값(프로세스 메모리·env)으로 주소에 HMAC 증명을 붙이고,
// proxy는 같은 비밀값으로 다시 계산해 timingSafeEqual로 대조한다. 비밀값이 없으면(server.ts를 거치지 않음) 항상 거부.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isPrivateIp } from "./ip.ts";

export const PEER_HEADER = "x-hsh-peer";
export const PEER_PROOF_HEADER = "x-hsh-peer-proof";
/** proxy.ts가 요청 경로를 레이아웃에 알려 주는 헤더(밖에서 온 값은 proxy가 덮어쓴다) */
export const PATH_HEADER = "x-hsh-path";
export const PEER_SECRET_ENV = "HSH_PEER_SECRET";

export const createPeerSecret = () => randomBytes(32).toString("hex");

export function peerProof(secret: string, peer: string): string {
  return createHmac("sha256", secret).update(`peer:${peer}`).digest("hex");
}

/** proxy용: 증명이 맞고 내부망 주소일 때만 true */
export function verifyPeer(peer: string | null | undefined, proof: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !peer || !proof) return false;
  const want = Buffer.from(peerProof(secret, peer));
  const got = Buffer.from(proof);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  return isPrivateIp(peer);
}

/**
 * server.ts용: 밖에서 보낸 PEER 헤더·증명 헤더는 항상 지우고, 소켓 주소가 내부망이면 주소와 증명을 담는다.
 * 내부망이 아니면 false(요청을 거부해야 한다).
 */
export function stampPeer(headers: Record<string, string | string[] | undefined>, remoteAddress: string | undefined, secret: string): boolean {
  delete headers[PEER_HEADER];
  delete headers[PEER_PROOF_HEADER];
  if (!isPrivateIp(remoteAddress) || !remoteAddress) return false;
  headers[PEER_HEADER] = remoteAddress;
  headers[PEER_PROOF_HEADER] = peerProof(secret, remoteAddress);
  return true;
}
