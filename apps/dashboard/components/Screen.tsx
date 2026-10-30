"use client";
import type { ApiState, SkinId } from "@hsh/core";
import { todayIn } from "@hsh/core";
import { useDashboardState } from "@/hooks/useDashboardState";
import { useDashboardView } from "@/hooks/useDashboardView";
import { useKioskGuards } from "@/hooks/useKioskGuards";
import { useNow } from "@/hooks/useNow";
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
  // 보기 상태(보는 달·시트·마지막 터치)는 폴링 결과와 따로 여기서 갖는다 -> 1분 폴링이 와도 유지, 120초 조용하면 초기화.
  const today = todayIn(useNow(at, initial.updatedAt));
  const { view, month, handlers } = useDashboardView(today.slice(0, 7));
  const { state, offline } = useDashboardState(initial, { month });
  useSkin(skinPreview ?? state.skin);
  useKioskGuards();
  const qr = useSetupQr(initialQr, state.needsSetup);
  return (
    // data-surface="tablet": 키오스크 CSS(핀치·당겨서 새로고침·글자 선택 차단)는 이 표식이 있을 때만 건다(휴대폰 /setup은 그대로)
    <div data-surface="tablet" style={{ display: "contents" }}>
      {state.needsSetup ? <SetupNeeded qr={qr} /> : <Dashboard state={state} offline={offline} at={at} mode={mode} browse={{ view, handlers }} />}
    </div>
  );
}
