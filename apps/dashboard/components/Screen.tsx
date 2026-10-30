"use client";
import type { ApiState, SkinId } from "@hsh/core";
import { useDashboardState } from "@/hooks/useDashboardState";
import { useSkin } from "@/hooks/useSkin";
import { useSetupQr, type SetupQrView } from "@/hooks/useSetupQr";
import { Dashboard } from "./Dashboard";
import { SetupNeeded } from "./SetupNeeded";

export interface ScreenProps {
  initial: ApiState;
  /** 서버가 처음 렌더할 때 만든 세팅 QR (세팅이 필요할 때만) */
  initialQr?: SetupQrView;
  at?: string;
  mode?: "day" | "night";
  /** 개발용 미리보기(?skin=<id>): 있으면 위키의 skin 대신 쓴다 */
  skinPreview?: SkinId;
}

/**
 * 태블릿이 한 번 열어 두면 계속 쓰는 화면. /api/state를 폴링해서
 * 세팅이 끝나면(needsSetup=false) 대시보드로, 위키가 비면 다시 세팅 화면으로 바꾼다.
 */
export function Screen({ initial, initialQr, at, mode, skinPreview }: ScreenProps) {
  const { state, offline } = useDashboardState(initial);
  useSkin(skinPreview ?? state.skin);
  const qr = useSetupQr(initialQr, state.needsSetup);
  if (state.needsSetup) return <SetupNeeded qr={qr} />;
  return <Dashboard state={state} offline={offline} at={at} mode={mode} />;
}
