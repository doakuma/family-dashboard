// 대화 흐름(conversation.ts)이 메신저에 바라는 것. 메신저 종류(슬랙 등)의 용어는 여기에 쓰지 않는다.
// 카드 문구·버튼 구성은 흐름이 정하고, 어댑터(slack/messenger.ts)는 그것을 그 메신저의 모양으로 그리기만 한다.

/** 답을 달 자리. threadId가 없으면 대화방 본문(DM 등)에 단다 */
export interface Thread {
  channelId: string;
  threadId?: string;
  /** 1:1 대화방인지(잡담에 되물을지 정할 때 쓴다) */
  isDirect: boolean;
}

/** 보낸 메시지를 나중에 고치기 위한 주소 */
export interface MessageRef {
  channelId: string;
  messageId: string;
}

export const ACTION_NAMES = ["insert", "edit", "cancel", "retry", "pick"] as const;
export type ActionName = (typeof ACTION_NAMES)[number];
export const isActionName = (v: unknown): v is ActionName => typeof v === "string" && (ACTION_NAMES as readonly string[]).includes(v);

export interface CardButton {
  action: ActionName;
  label: string;
  /** primary = 주 동작(넣기), danger = 되돌리기 어려운 동작 */
  style?: "primary" | "danger";
  pendingId: string;
  /** pick: 고른 후보 id */
  pickId?: string;
}

/** 버튼이 달릴 수 있는 메시지. buttons가 비면 글만 */
export interface Card {
  text: string;
  buttons: CardButton[];
}

export interface ConversationUi {
  post(thread: Thread, card: Card): Promise<MessageRef>;
  update(ref: MessageRef, card: Card): Promise<void>;
  /** 그 사람에게만 보이는 짧은 안내 */
  whisper(thread: Thread, userId: string, text: string): Promise<void>;
}

/** 메신저에서 들어온 글 */
export interface ConversationMessage {
  userId: string;
  text: string;
  thread: Thread;
}

/** 메신저에서 눌린 버튼 */
export interface ActionInput {
  action: ActionName;
  pendingId: string;
  pickId?: string;
  userId: string;
  thread: Thread;
  /** 버튼이 달린 메시지(보관소에 없는 요청의 카드를 정리할 때 쓴다) */
  card?: MessageRef;
}

export const textCard = (text: string): Card => ({ text, buttons: [] });
