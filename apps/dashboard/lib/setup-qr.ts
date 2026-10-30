// 태블릿 "세팅 필요" 화면의 QR. 주소는 DASHBOARD_BASE_URL에서 만들고 Host 헤더는 보지 않는다.
import "server-only";
import QRCode from "qrcode";
import { resolveBaseUrl } from "./auth/base-url";
import { authState } from "./auth/server";
import { netConfig } from "./config";

export type SetupQr = { ok: true; /** 화면에 글자로 보여 줄 주소(토큰 제외) */ label: string; /** QR에 담긴 전체 주소 */ url: string; svg: string } | { ok: false; reason: "missing" | "invalid" };

export async function getSetupQr(): Promise<SetupQr> {
  const base = resolveBaseUrl(netConfig());
  if (!base.ok) return base;
  const url = `${base.url}/setup?t=${authState().tokens.current()}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#1c2a32", light: "#ffffff" } });
  return { ok: true, label: `${base.url}/setup`, url, svg };
}
