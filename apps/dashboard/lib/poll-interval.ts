// /api/state 폴링 간격. 세팅 화면(needsSetup)은 [시작하기] 뒤 몇 초 안에 대시보드로 바뀌어야 해서 짧게, 대시보드는 1분.
export const DASHBOARD_POLL_MS = 60_000;
export const SETUP_POLL_MS = 5_000;

export function pollIntervalMs(needsSetup: boolean): number {
  return needsSetup ? SETUP_POLL_MS : DASHBOARD_POLL_MS;
}
