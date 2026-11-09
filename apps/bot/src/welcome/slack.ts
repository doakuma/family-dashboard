// 환영 메시지를 슬랙에 올리는 어댑터. 슬랙 클라이언트는 messenger.ts의 SlackChatClient(chat.postMessage)를 그대로 쓴다.
// 토큰은 env에서 직접 읽지 않고 InstallationStore.fetchInstallation()으로만 받는다(결정 0003).
import type { InstallationStore } from "@slack/bolt";
import type { SlackChatClient } from "../slack/messenger";
import type { WelcomePoster } from "./worker";

type ChatClient = { chat: Pick<SlackChatClient["chat"], "postMessage"> };

/**
 * 게시 때마다 설치 정보에서 봇 토큰을 받아 클라이언트를 만든다(토큰 교체·워크스페이스별 설치로 바뀌어도 따라간다).
 * postMessage는 멱등이 아니라서 클라이언트 쪽 재시도는 끈다: 재시도는 WelcomeWorker의 백오프에서만 한다(타임아웃 뒤 재시도하면 같은 글이 두 번 올라갈 수 있다).
 */
export function slackWelcomePoster(store: Pick<InstallationStore, "fetchInstallation">, createClient: (token: string) => ChatClient): WelcomePoster {
  return async (channel, text) => {
    const inst = await store.fetchInstallation({ teamId: undefined, enterpriseId: undefined, isEnterpriseInstall: false });
    const token = inst.bot?.token;
    if (!token) throw new Error("봇 설치 정보(토큰)를 찾지 못했어요");
    const r = await createClient(token).chat.postMessage({ channel, text });
    // Web API는 보통 오류를 던지지만, ok:false로 돌아오는 경우도 실패로 본다
    if (r.ok === false) throw new Error("슬랙이 메시지를 받지 않았어요");
  };
}

/** WebClient 옵션: 10초 제한, 자동 재시도 없음, 레이트리밋이면 기다리지 않고 바로 실패 */
export const WELCOME_CLIENT_OPTIONS = { timeout: 10_000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true } as const;
