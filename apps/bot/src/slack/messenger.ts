// 슬랙 어댑터: 대화 흐름(flow/)의 카드를 Block Kit으로 그리고, 슬랙 이벤트·버튼 페이로드를 흐름의 입력으로 바꾼다.
// 슬랙 페이로드는 외부 입력이라 zod로 검증한다. 흐름 쪽 판단(무엇을 묻고 무엇을 넣을지)은 여기서 하지 않는다.
import { z } from "zod";
import { isActionName, type ActionInput, type Card, type ConversationMessage, type ConversationUi, type MessageRef, type Thread } from "../flow/ui";

/** 이 봇의 버튼 action_id 앞머리. Bolt에는 /^hsh:/ 로 등록한다 */
export const ACTION_PREFIX = "hsh:";
export const ACTION_PATTERN = /^hsh:/;
/** 슬랙 버튼 글자 상한(plain_text 75자) */
const BUTTON_TEXT_MAX = 75;
/** section 글 상한(3000자) */
const SECTION_TEXT_MAX = 3000;

/** 슬랙 Web API 중 이 봇이 쓰는 부분만. 테스트에서는 가짜로 바꾼다 */
export interface SlackChatClient {
  chat: {
    postMessage(args: { channel: string; text: string; thread_ts?: string; blocks?: SlackBlock[] }): Promise<{ ok?: boolean; ts?: string; channel?: string }>;
    update(args: { channel: string; ts: string; text: string; blocks: SlackBlock[] }): Promise<unknown>;
    postEphemeral(args: { channel: string; user: string; text: string; thread_ts?: string }): Promise<unknown>;
  };
}

export type SlackBlock =
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "actions"; block_id: string; elements: SlackButton[] };

export interface SlackButton {
  type: "button";
  action_id: string;
  text: { type: "plain_text"; text: string; emoji: true };
  value: string;
  style?: "primary" | "danger";
}

/** 슬랙 mrkdwn 특수 문자(&, <, >)를 이스케이프한다. 사용자가 쓴 글이 링크·멘션으로 바뀌지 않게 */
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cut(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** 카드 → { text(알림·접근성용 대체 글), blocks } */
export function renderCard(card: Card): { text: string; blocks: SlackBlock[] } {
  const blocks: SlackBlock[] = [{ type: "section", text: { type: "mrkdwn", text: cut(escapeMrkdwn(card.text), SECTION_TEXT_MAX) } }];
  const first = card.buttons[0];
  if (first) {
    blocks.push({
      type: "actions",
      block_id: `${ACTION_PREFIX}${first.pendingId}`,
      elements: card.buttons.map((b, i) => ({
        type: "button",
        // action_id는 한 블록 안에서 겹치면 안 된다 → 순번을 붙인다
        action_id: `${ACTION_PREFIX}${b.action}:${i}`,
        text: { type: "plain_text", text: cut(b.label, BUTTON_TEXT_MAX), emoji: true },
        value: b.pickId ? `${b.pendingId}|${b.pickId}` : b.pendingId,
        ...(b.style ? { style: b.style } : {}),
      })),
    });
  }
  return { text: cut(card.text, SECTION_TEXT_MAX), blocks };
}

/** 1:1 대화방(DM) 채널 id는 D로 시작한다 */
const isDmChannel = (id: string) => id.startsWith("D");

const messageEventSchema = z.object({
  type: z.literal("message"),
  subtype: z.undefined().optional(),
  bot_id: z.undefined().optional(),
  user: z.string().min(1),
  text: z.string(),
  channel: z.string().min(1),
  channel_type: z.string().optional(),
  ts: z.string().min(1),
  thread_ts: z.string().optional(),
});

/**
 * 슬랙 message 이벤트 → 흐름 입력. 듣지 않는 글이면 undefined.
 * 듣는 곳: 1:1 대화방과 가족 채널(familyChannel, 채널 id)만. 봇 글·수정·삭제 같은 subtype은 무시한다.
 */
export function toConversationMessage(event: unknown, opts: { familyChannel?: string }): ConversationMessage | undefined {
  const r = messageEventSchema.safeParse(event);
  if (!r.success) return undefined;
  const m = r.data;
  const isDirect = m.channel_type === "im" || isDmChannel(m.channel);
  if (!isDirect && (!opts.familyChannel || m.channel !== opts.familyChannel)) return undefined;
  // 봇을 부른 멘션(<@U…>)은 떼고 읽는다
  const text = m.text.replace(/<@[A-Z0-9]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  // 단체 채널은 사용자의 글 아래 스레드에 답한다. DM은 스레드에서 말했을 때만 스레드에 답한다.
  const thread: Thread = isDirect ? { channelId: m.channel, threadId: m.thread_ts, isDirect } : { channelId: m.channel, threadId: m.thread_ts ?? m.ts, isDirect };
  return { userId: m.user, text, thread };
}

const actionBodySchema = z.object({
  type: z.literal("block_actions"),
  user: z.object({ id: z.string().min(1) }),
  channel: z.object({ id: z.string().min(1) }).optional(),
  message: z.object({ ts: z.string().min(1), thread_ts: z.string().optional() }).optional(),
  actions: z.array(z.object({ action_id: z.string(), value: z.string().optional() })).min(1),
});

/** 슬랙 block_actions 페이로드 → 흐름 입력. 이 봇의 버튼이 아니거나 모양이 틀리면 undefined */
export function toActionInput(body: unknown): ActionInput | undefined {
  const r = actionBodySchema.safeParse(body);
  if (!r.success) return undefined;
  const b = r.data;
  const act = b.actions[0];
  const channelId = b.channel?.id;
  if (!act || !channelId || !act.action_id.startsWith(ACTION_PREFIX) || !act.value) return undefined;
  const name = act.action_id.slice(ACTION_PREFIX.length).split(":")[0];
  if (!isActionName(name)) return undefined;
  const [pendingId, pickId] = act.value.split("|");
  if (!pendingId) return undefined;
  const isDirect = isDmChannel(channelId);
  return {
    action: name,
    pendingId,
    pickId: pickId || undefined,
    userId: b.user.id,
    thread: { channelId, threadId: b.message?.thread_ts, isDirect },
    card: b.message ? { channelId, messageId: b.message.ts } : undefined,
  };
}

/**
 * ConversationUi의 슬랙 구현. 클라이언트는 부를 때마다 받아 온다(토큰은 설치 저장소가 안다 - 결정 0003).
 */
export class SlackUi implements ConversationUi {
  constructor(private readonly client: () => Promise<SlackChatClient>) {}

  async post(thread: Thread, card: Card): Promise<MessageRef> {
    const c = await this.client();
    const r = await c.chat.postMessage({ channel: thread.channelId, ...(thread.threadId ? { thread_ts: thread.threadId } : {}), ...renderCard(card) });
    if (!r.ts) throw new Error("슬랙 메시지를 보냈지만 ts를 받지 못했어요");
    return { channelId: r.channel ?? thread.channelId, messageId: r.ts };
  }

  async update(ref: MessageRef, card: Card): Promise<void> {
    const c = await this.client();
    await c.chat.update({ channel: ref.channelId, ts: ref.messageId, ...renderCard(card) });
  }

  async whisper(thread: Thread, userId: string, text: string): Promise<void> {
    const c = await this.client();
    await c.chat.postEphemeral({ channel: thread.channelId, user: userId, text, ...(thread.threadId ? { thread_ts: thread.threadId } : {}) });
  }
}
