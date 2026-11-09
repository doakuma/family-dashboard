// 환영 메시지를 슬랙에 올리는 어댑터. 슬랙 클라이언트는 messenger.ts의 SlackChatClient(chat.postMessage)를 그대로 쓴다.
import type { SlackChatClient } from "../slack/messenger";
import type { WelcomePoster } from "./worker";

export function slackWelcomePoster(client: { chat: Pick<SlackChatClient["chat"], "postMessage"> }): WelcomePoster {
  return async (channel, text) => {
    const r = await client.chat.postMessage({ channel, text });
    // Web API는 보통 오류를 던지지만, ok:false로 돌아오는 경우도 실패로 본다
    if (r.ok === false) throw new Error("슬랙이 메시지를 받지 않았어요");
  };
}
