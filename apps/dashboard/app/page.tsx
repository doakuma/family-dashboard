import type { Viewport } from "next";
import { config } from "@/lib/config";
import { parsePreview } from "@/lib/preview";
import { Screen } from "@/components/Screen";
import { getSetupQr } from "@/lib/setup-qr";
import { getApiState } from "@/lib/state";

export const dynamic = "force-dynamic";

// 거실 태블릿 화면만 확대를 막는다(핀치 줌 방지). 휴대폰 /setup은 확대를 그대로 둔다(접근성). 나머지 viewport 값(너비·테마색)은 layout 것을 쓴다.
export const viewport: Viewport = { maximumScale: 1, userScalable: false };

interface Props {
  // 시안·점검용(개발 모드에서만, 운영은 무시): ?at=2026-10-29T10:30:00%2B09:00  ?mode=night  ?skin=paper
  searchParams: Promise<{ at?: string; mode?: string; skin?: string }>;
}

export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  const { at, mode, skin } = parsePreview(params, config.get("previewQuery"));
  const state = await getApiState(at ? new Date(at) : undefined);

  // 세팅이 필요할 때만 일회용 토큰을 만든다. 주소는 Host 헤더가 아니라 DASHBOARD_BASE_URL 기준.
  const qr = state.needsSetup ? await getSetupQr() : undefined;

  return <Screen initial={state} initialQr={qr} at={at} mode={mode} skinPreview={skin} />;
}
