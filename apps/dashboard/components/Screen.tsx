"use client";
import type { ApiState } from "@hsh/core";
import { useDashboardState } from "@/hooks/useDashboardState";
import { Dashboard } from "./Dashboard";
import { SetupNeeded } from "./SetupNeeded";

export interface ScreenProps {
  initial: ApiState;
  /** 세팅 화면에 보여 줄 QR(SVG)과 주소. 서버에서 만든다. */
  qrSvg: string;
  url: string;
  at?: string;
  mode?: "day" | "night";
}

/**
 * 태블릿이 한 번 열어 두면 계속 쓰는 화면. /api/state를 폴링해서
 * 세팅이 끝나면(needsSetup=false) 대시보드로, 위키가 비면 다시 세팅 화면으로 바꾼다.
 */
export function Screen({ initial, qrSvg, url, at, mode }: ScreenProps) {
  const { state, offline } = useDashboardState(initial);
  if (state.needsSetup) return <SetupNeeded qrSvg={qrSvg} url={url} />;
  return <Dashboard state={state} offline={offline} at={at} mode={mode} />;
}
