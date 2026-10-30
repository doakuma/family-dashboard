// 시작 시 봇 토큰 검증. 토큰이 틀리면 Socket Mode 연결 뒤에야 첫 이벤트에서 터져서 원인을 찾기 어렵다.
// 종료 코드 판단(PM2 재시작 반복 방지): 토큰 자체가 잘못된 오류(영구)는 78(설정 오류)로 끝내고 ecosystem.config.cjs의
// stop_exit_codes로 PM2가 다시 띄우지 않게 한다. 네트워크 등 일시 오류는 1로 끝내 PM2가 restart_delay 간격으로 다시 시도한다(max_restarts 안에서).

/** 토큰을 다시 시도해도 소용없는 Slack 오류 코드 */
const PERMANENT = new Set(["invalid_auth", "not_authed", "account_inactive", "token_revoked", "token_expired"]);

export const EXIT_CONFIG = 78;
export const EXIT_RETRY = 1;

export interface WhoAmI {
  botId?: string;
  botUserId?: string;
}

function slackErrorCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const data = (e as { data?: unknown }).data;
  if (typeof data === "object" && data !== null) {
    const code = (data as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export type TokenCheck = { ok: true; who: WhoAmI } | { ok: false; exitCode: number; message: string };

/** auth.test를 한 번 불러 결과를 판정한다. 던지지 않는다. */
export async function checkBotToken(whoami: (token: string) => Promise<WhoAmI>, token: string): Promise<TokenCheck> {
  try {
    return { ok: true, who: await whoami(token) };
  } catch (e) {
    const code = slackErrorCode(e);
    if (code && PERMANENT.has(code)) {
      return { ok: false, exitCode: EXIT_CONFIG, message: `SLACK_BOT_TOKEN이 올바르지 않아요(${code}). 토큰을 확인하세요. 다시 시도해도 소용없어 재시작하지 않고 멈춰요.` };
    }
    const reason = code ?? (e instanceof Error ? e.message : String(e));
    return { ok: false, exitCode: EXIT_RETRY, message: `슬랙에 확인하지 못했어요(${reason}). 네트워크 문제일 수 있어 잠시 뒤 다시 시도해요.` };
  }
}
