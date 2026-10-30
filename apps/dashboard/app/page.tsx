import { isSkinId } from "@hsh/core";
import { Screen } from "@/components/Screen";
import { getSetupQr } from "@/lib/setup-qr";
import { getApiState } from "@/lib/state";

export const dynamic = "force-dynamic";

interface Props {
  // 시안·점검용: ?at=2026-10-29T10:30:00%2B09:00  ?mode=night  ?skin=paper
  searchParams: Promise<{ at?: string; mode?: string; skin?: string }>;
}

export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  const at = params.at && !Number.isNaN(Date.parse(params.at)) ? params.at : undefined;
  const state = await getApiState(at ? new Date(at) : undefined);

  // 세팅이 필요할 때만 일회용 토큰을 만든다. 주소는 Host 헤더가 아니라 DASHBOARD_BASE_URL 기준.
  const qr = state.needsSetup ? await getSetupQr() : undefined;

  const mode = params.mode === "night" || params.mode === "day" ? params.mode : undefined;
  return <Screen initial={state} initialQr={qr} at={at} mode={mode} skinPreview={isSkinId(params.skin) ? params.skin : undefined} />;
}
