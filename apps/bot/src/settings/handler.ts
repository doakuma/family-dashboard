// 슬랙 설정 변경 고정 명령(#22): "하늘이 색 초록으로 바꿔줘" -> 미리보기 [바꾸기][취소] -> 위키 member.color.
// LLM을 거치지 않는다(코드가 문장 모양을 직접 인식). 보호자만. 쓰기는 WikiRepository.applySettings 하나.
// 자리: ConnectHandler 다음, Conversation(LLM)보다 먼저. 모양이 안 맞거나 대상 구성원이 없으면 가로채지 않고(false) 기존 흐름으로 넘긴다.
// 슬랙과 무관하다: 응답 창구는 ConversationUi 포트.
import { COLOR_LIST_TEXT, SettingsError, canWrite, colorLabel, permissionFor, type FamilyId, type Member, type Permission, type WikiRepository } from "@hsh/core";
import { TEXT as FLOW_TEXT } from "../flow/conversation";
import { textCard, type ActionInput, type Card, type CardButton, type ConversationMessage, type ConversationUi, type Thread } from "../flow/ui";
import { parseColorCommand } from "./parse";
import { SettingsPendingStore, isSettingsPendingId, type SettingsPending } from "./pending";
import { findMembers } from "./resolve";

export { isSettingsPendingId };

/** 받침이 없거나 ㄹ이면 "로", 아니면 "으로" */
export function euro(word: string): string {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  if (last < 0 || last > 11171) return "(으)로";
  const jong = last % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}
/** 받침이 있으면 "이에요", 없으면 "예요" */
export function iyeyo(word: string): string {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  if (last < 0 || last > 11171) return "(이)에요";
  return last % 28 === 0 ? "예요" : "이에요";
}

export const SETTINGS_TEXT = {
  childNoSettings: "아이 계정은 설정을 바꿀 수 없어요. 보호자에게 부탁해 주세요.",
  unregistered: FLOW_TEXT.unregisteredNoWrite,
  readFailed: FLOW_TEXT.readFailed,
  readRetry: FLOW_TEXT.readRetry,
  expired: FLOW_TEXT.expired,
  notOwner: FLOW_TEXT.notOwner,
  applying: "⏳ 바꾸는 중…",
  cancelled: "취소했어요",
  gone: "구성원을 찾을 수 없어요. 설정이 바뀌었을 수 있어요. 다시 말해 주세요.",
  unknownColor: (word: string) => `'${word}'은(는) 고를 수 없는 색이에요. 고를 수 있는 색: ${COLOR_LIST_TEXT}`,
  ambiguous: (target: string, names: string[]) => `'${target}'에 해당하는 구성원이 여럿이에요: ${names.join(", ")}. 이름을 정확히 말해 주세요.`,
  same: (name: string, color: string) => `${name} 색은 이미 ${colorLabel(color)}${iyeyo(colorLabel(color))}.`,
  ask: (name: string, from: string, to: string) => `${name} 색을 ${colorLabel(from)} → ${colorLabel(to)}${euro(colorLabel(to))} 바꿀까요?`,
  done: (name: string, from: string, to: string) => `✅ ${name} 색을 ${colorLabel(from)} → ${colorLabel(to)}${euro(colorLabel(to))} 바꿨어요`,
} as const;

/** 작성자 표기: 슬랙 ID는 위키(GitHub)에 남기지 않고 구성원 이름으로. 커밋 작성자 줄을 깨는 글자는 뺀다 */
const authorOf = (m: Pick<Member, "name"> | undefined): string => {
  const name = m?.name.replace(/[<>\r\n]/g, "").trim();
  return name ? `slack:${name}` : "slack";
};

export interface SettingsCommandDeps {
  wiki: Pick<WikiRepository, "read" | "applySettings">;
  ui: ConversationUi;
  familyId: FamilyId;
  pending?: SettingsPendingStore;
  log?: (message: string) => void;
}

const denyText = (p: Permission): string | undefined => (canWrite(p) ? undefined : p === "child" ? SETTINGS_TEXT.childNoSettings : SETTINGS_TEXT.unregistered);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class SettingsCommandHandler {
  private readonly pending: SettingsPendingStore;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: SettingsCommandDeps) {
    this.pending = deps.pending ?? new SettingsPendingStore();
    this.log = deps.log ?? ((m) => console.error(`[bot] ${m}`));
  }

  /**
   * 색 변경 명령이면 처리하고 true(대화 흐름으로 넘기지 않는다). 아니면 false. 던지지 않는다.
   * 문장 모양이 안 맞으면 위키도 읽지 않는다.
   */
  async tryHandle(msg: ConversationMessage): Promise<boolean> {
    const cmd = parseColorCommand(msg.text);
    if (!cmd) return false;
    const { thread, userId } = msg;
    let wiki;
    try {
      wiki = await this.deps.wiki.read(this.deps.familyId);
    } catch (e) {
      this.log(`설정 명령: 위키 읽기 실패: ${errorText(e)}`);
      await this.safePost(thread, textCard(SETTINGS_TEXT.readFailed));
      return true;
    }
    const people = wiki.members.filter((m) => m.id !== "family");
    const match = findMembers(cmd.target, people);
    // 구성원이 아닌 것에 대한 말("벽 색 초록으로 바꿔줘")은 우리 명령이 아니다
    if (match.type === "none") return false;

    const deny = denyText(permissionFor(wiki.members, userId));
    if (deny) {
      await this.safePost(thread, textCard(deny));
      return true;
    }
    if (match.type === "many") {
      await this.safePost(thread, textCard(SETTINGS_TEXT.ambiguous(cmd.target, match.members.map((m) => m.name))));
      return true;
    }
    if (!cmd.color) {
      await this.safePost(thread, textCard(SETTINGS_TEXT.unknownColor(cmd.colorWord)));
      return true;
    }
    const member = match.member;
    if (member.color === cmd.color) {
      await this.safePost(thread, textCard(SETTINGS_TEXT.same(member.name, cmd.color)));
      return true;
    }
    const p = this.pending.create({ familyId: this.deps.familyId, userId, thread, memberId: member.id, memberName: member.name, color: cmd.color, status: "confirm" });
    // 미리보기에 보이는 '이전 색'은 이 시점의 값이다. 버튼 시점에 다시 읽어 최신 값으로 판단한다
    try {
      p.card = await this.deps.ui.post(thread, confirmCard(p, member.color));
    } catch (e) {
      this.pending.transition(p, ["confirm"], "cancelled");
      this.log(`설정 명령: 카드 보내기 실패(${p.id}): ${errorText(e)}`);
    }
    return true;
  }

  /** [바꾸기][다시 시도][취소] 버튼. 던지지 않는다 */
  async handleAction(a: ActionInput): Promise<void> {
    const p = this.pending.get(a.pendingId);
    if (!p) {
      if (a.card) await this.safeUpdate(a.card.channelId, a.card.messageId, textCard(SETTINGS_TEXT.expired));
      return;
    }
    if (a.userId !== p.userId) {
      await this.safeWhisper(a.thread, a.userId, SETTINGS_TEXT.notOwner);
      return;
    }
    switch (a.action) {
      case "cancel":
        if (this.pending.transition(p, ["confirm", "failed"], "cancelled")) await this.updateCard(p, textCard(`${SETTINGS_TEXT.cancelled}: ${goal(p)} 바꾸기`));
        return;
      case "insert":
        if (this.pending.transition(p, ["confirm"], "applying")) await this.run(p, "confirm");
        return;
      case "retry":
        if (this.pending.transition(p, ["failed"], "applying")) await this.run(p, "failed");
        return;
      default:
        // edit·pick은 이 요청에 없는 버튼이다
        return;
    }
  }

  /**
   * 누르는 순간 위키를 다시 읽어 권한·구성원·현재 색을 재판정하고 쓴다(#21과 같은 규칙).
   * 읽기 실패는 요청을 닫지 않고 back 상태로 되돌린다(권한 거절이 아니므로).
   */
  private async run(p: SettingsPending, back: "confirm" | "failed"): Promise<void> {
    await this.updateCard(p, textCard(`${SETTINGS_TEXT.applying}\n${goal(p)} 바꾸는 중`));
    let wiki;
    try {
      wiki = await this.deps.wiki.read(p.familyId);
    } catch (e) {
      this.log(`설정 명령: 권한 확인 위해 위키 읽기 실패: ${errorText(e)}`);
      if (this.pending.transition(p, ["applying"], back)) {
        const card = back === "failed" ? failedCard(p) : confirmCard(p);
        await this.updateCard(p, { ...card, text: `${card.text}\n${SETTINGS_TEXT.readRetry}` });
      }
      return;
    }
    const deny = denyText(permissionFor(wiki.members, p.userId));
    if (deny) {
      if (this.pending.transition(p, ["applying"], "cancelled")) await this.updateCard(p, textCard(deny));
      return;
    }
    const member = wiki.members.find((m) => m.id === p.memberId && m.id !== "family");
    if (!member) {
      if (this.pending.transition(p, ["applying"], "cancelled")) await this.updateCard(p, textCard(SETTINGS_TEXT.gone));
      return;
    }
    if (member.color === p.color) {
      // 그 사이 다른 방법으로 이미 바뀜
      this.pending.transition(p, ["applying"], "done");
      await this.updateCard(p, textCard(SETTINGS_TEXT.same(member.name, p.color)));
      return;
    }
    const sender = wiki.members.find((m) => m.slackId === p.userId);
    try {
      const r = await this.deps.wiki.applySettings(p.familyId, { kind: "member.color", payload: { id: member.id, color: p.color } }, { author: authorOf(sender) });
      this.pending.transition(p, ["applying"], "done");
      const sync = !r.synced && r.syncError ? `\n(위키 저장은 됐지만 원격 동기화는 실패했어요: ${truncate(r.syncError, 300)})` : "";
      if (sync) this.log(`설정 명령: 동기화 실패(${p.id}): ${r.syncError ?? ""}`);
      await this.updateCard(p, textCard(`${SETTINGS_TEXT.done(member.name, member.color, p.color)}${sync}`));
    } catch (e) {
      if (e instanceof SettingsError && (e.code === "not_found" || e.code === "needs_setup")) {
        if (this.pending.transition(p, ["applying"], "cancelled")) await this.updateCard(p, textCard(SETTINGS_TEXT.gone));
        return;
      }
      this.pending.transition(p, ["applying"], "failed");
      p.lastError = errorText(e);
      this.log(`설정 명령: 위키 쓰기 실패(${p.id}): ${p.lastError}`);
      await this.updateCard(p, failedCard(p));
    }
  }

  private async updateCard(p: SettingsPending, card: Card): Promise<void> {
    if (p.card) await this.safeUpdate(p.card.channelId, p.card.messageId, card);
  }

  private async safeUpdate(channelId: string, messageId: string, card: Card): Promise<void> {
    try {
      await this.deps.ui.update({ channelId, messageId }, card);
    } catch (e) {
      this.log(`설정 명령: 카드 고치기 실패: ${errorText(e)}`);
    }
  }

  private async safePost(thread: Thread, card: Card): Promise<void> {
    try {
      await this.deps.ui.post(thread, card);
    } catch (e) {
      this.log(`설정 명령: 답글 실패: ${errorText(e)}`);
    }
  }

  private async safeWhisper(thread: Thread, userId: string, text: string): Promise<void> {
    try {
      await this.deps.ui.whisper(thread, userId, text);
    } catch (e) {
      this.log(`설정 명령: 안내 실패: ${errorText(e)}`);
    }
  }
}

/** "하늘 색을 초록으로" */
const goal = (p: SettingsPending) => `${p.memberName} 색을 ${colorLabel(p.color)}${euro(colorLabel(p.color))}`;

const button = (p: SettingsPending, action: CardButton["action"], label: string, style?: CardButton["style"]): CardButton => ({ action, label, style, pendingId: p.id });

/** "하늘 색을 파랑 → 초록으로 바꿀까요?" + [바꾸기][취소]. from을 모르면(버튼 시점 복귀) 이름·색만 */
function confirmCard(p: SettingsPending, from?: string): Card {
  const text = from ? SETTINGS_TEXT.ask(p.memberName, from, p.color) : `${goal(p)} 바꿀까요?`;
  return { text, buttons: [button(p, "insert", "바꾸기", "primary"), button(p, "cancel", "취소")] };
}

function failedCard(p: SettingsPending): Card {
  return {
    text: `⚠️ 못 바꿨어요: ${goal(p)}\n원인: ${truncate(p.lastError ?? "", 300)}`,
    buttons: [button(p, "retry", "다시 시도", "primary"), button(p, "cancel", "취소")],
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
