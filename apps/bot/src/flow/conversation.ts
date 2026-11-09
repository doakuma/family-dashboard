// 메신저 한 바퀴: 글 → 의도 → (질문이면 답 | 쓰기면 미리보기 + [넣기][고치기][취소]) → 버튼 → 위키 쓰기 → "넣었어요".
// 메신저 종류와 무관하다(ConversationUi 포트로만 말한다). 위키 쓰기는 WikiRepository.apply만 한다.
// 권한(보호자만 쓰기, #21)과 캘린더 복사(#11)는 아직 붙이지 않았다.
import { todayIn, type FamilyId, type LlmAdapter, type WikiRepository, type WikiState } from "@hsh/core";
import { answerFromQuery } from "../answer/answer";
import { formatWhen } from "../format";
import { extractIntent, resolveChoice, type Intent } from "../intent/extract";
import { PendingStore, type Pending } from "./pending";
import { textCard, type ActionInput, type Card, type CardButton, type ConversationMessage, type ConversationUi, type Thread } from "./ui";

export interface ConversationDeps {
  wiki: Pick<WikiRepository, "read" | "apply">;
  llm: LlmAdapter;
  ui: ConversationUi;
  familyId: FamilyId;
  pending?: PendingStore;
  now?: () => Date;
  /** 실패 원인을 남길 곳(기본: console.error) */
  log?: (message: string) => void;
}

/** 후보 버튼 최대 개수(그 이상은 더 구체적으로 말해 달라고 한다) */
export const MAX_CANDIDATES = 5;
/** 카드에 싣는 실패 원인 최대 길이 */
const MAX_CAUSE = 300;

export const TEXT = {
  ask: "넣을까요?",
  inserting: "⏳ 넣는 중…",
  inserted: "넣었어요",
  cancelled: "취소했어요",
  editing: "✏️ 고칠 내용을 이 스레드에 보내 주세요. 처음 말과 합쳐서 다시 확인할게요.",
  editingDirect: "✏️ 고칠 내용을 이 대화에 보내 주세요. 처음 말과 합쳐서 다시 확인할게요.",
  edited: "✏️ 고친 내용으로 다시 확인할게요.",
  expired: "⌛ 시간이 지났거나 봇이 다시 켜져서 이 버튼은 쓸 수 없어요. 다시 말해 주세요.",
  notOwner: "요청한 분만 누를 수 있어요.",
  llmFailed: "지금은 말을 알아듣지 못했어요(언어 모델 연결 문제). 잠시 뒤 다시 보내 주세요.",
  unrelated: '일정이에요? 예: "다음 주 화요일 3시 치과", "우유 사야 돼", "이번 주 토요일 뭐 있어?"',
  readFailed: "위키를 읽지 못했어요. 잠시 뒤 다시 보내 주세요.",
  tooMany: "비슷한 항목이 많아요. 날짜나 이름을 더 붙여서 다시 말해 주세요.",
} as const;

export class Conversation {
  private readonly pending: PendingStore;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: ConversationDeps) {
    this.pending = deps.pending ?? new PendingStore();
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((m) => console.error(`[bot] ${m}`));
  }

  /** 메신저에서 들어온 글 하나를 처리한다. 던지지 않는다(실패는 답글과 로그로 알린다). */
  async handleMessage(msg: ConversationMessage): Promise<void> {
    const said = msg.text.trim();
    if (!said) return;
    const { thread, userId } = msg;

    // 고치는 중이면: 처음 말 + 고친 내용을 함께 다시 해석한다. 처음 카드는 닫는다.
    const editing = this.pending.findEditing(userId, thread);
    let text = said;
    if (editing && this.pending.transition(editing, ["editing"], "replaced")) {
      text = `${editing.text}\n고친 내용: ${said}`;
      await this.updateCard(editing, textCard(`${TEXT.edited}\n(처음: ${editing.preview})`));
    }

    let wiki: WikiState;
    try {
      wiki = await this.deps.wiki.read(this.deps.familyId);
    } catch (e) {
      this.log(`위키 읽기 실패: ${errorText(e)}`);
      await this.safePost(thread, textCard(TEXT.readFailed));
      return;
    }

    // "@U…"(메신저 사용자 멘션)는 구성원 이름으로 바꿔 LLM에 보낸다
    text = text.replace(/@(U[A-Z0-9]+)/g, (m, id: string) => wiki.members.find((x) => x.slackId === id)?.name ?? m);
    const now = this.now();
    const intent = await extractIntent({ text, now, senderSlackId: userId, ...wiki }, this.deps.llm);
    await this.respond(intent, { msg, text, wiki, today: todayIn(now), wasEditing: !!editing });
  }

  /** 버튼 하나를 처리한다. 던지지 않는다. */
  async handleAction(a: ActionInput): Promise<void> {
    const p = this.pending.get(a.pendingId);
    if (!p) {
      if (a.card) await this.safeUpdate(a.card.channelId, a.card.messageId, textCard(TEXT.expired));
      return;
    }
    if (a.userId !== p.userId) {
      await this.safeWhisper(a.thread, a.userId, TEXT.notOwner);
      return;
    }

    switch (a.action) {
      case "insert":
        if (this.pending.transition(p, ["confirm"], "applying")) await this.runApply(p);
        return;
      case "retry":
        if (this.pending.transition(p, ["failed"], "applying")) await this.runApply(p);
        return;
      case "edit":
        // 일부를 이미 넣은 요청은 고치면 넣은 것까지 다시 들어가므로 고치기를 받지 않는다
        if (p.applied === 0 && this.pending.transition(p, ["confirm", "failed"], "editing")) {
          const ask = p.thread.isDirect ? TEXT.editingDirect : TEXT.editing;
          await this.updateCard(p, { text: `${ask}\n(처음: ${p.preview})`, buttons: [button(p, "cancel", "취소")] });
        }
        return;
      case "cancel":
        if (this.pending.transition(p, ["confirm", "choose", "failed", "editing"], "cancelled")) {
          const kept = p.applied > 0 ? `\n(앞의 ${p.applied}개는 이미 넣었어요)` : "";
          await this.updateCard(p, textCard(`${TEXT.cancelled}: ${p.preview}${kept}`));
        }
        return;
      case "pick":
        if (a.pickId && this.pending.transition(p, ["choose"], "confirm")) await this.resolvePick(p, a.pickId);
        return;
      default: {
        const never: never = a.action;
        this.log(`알 수 없는 버튼: ${String(never)}`);
      }
    }
  }

  private async respond(intent: Intent, ctx: { msg: ConversationMessage; text: string; wiki: WikiState; today: string; wasEditing: boolean }): Promise<void> {
    const { msg, wiki, today } = ctx;
    const { thread, userId } = msg;
    switch (intent.type) {
      case "question": {
        const answered = answerFromQuery(intent.query, { today, members: wiki.members, events: wiki.events, tasks: wiki.tasks, anniversaries: wiki.anniversaries });
        await this.safePost(thread, textCard(answered.text));
        return;
      }
      case "change": {
        const p = this.pending.create({ familyId: this.deps.familyId, userId, thread, text: ctx.text, status: "confirm", changes: intent.changes, preview: intent.preview });
        await this.postCard(p, confirmCard(p));
        return;
      }
      case "choose": {
        const candidates = intent.candidates.slice(0, MAX_CANDIDATES + 1);
        if (candidates.length > MAX_CANDIDATES) {
          await this.safePost(thread, textCard(TEXT.tooMany));
          return;
        }
        const p = this.pending.create({
          familyId: this.deps.familyId,
          userId,
          thread,
          text: ctx.text,
          status: "choose",
          changes: [],
          preview: intent.preview,
          choice: { kind: intent.kind, candidates, patch: intent.patch },
        });
        await this.postCard(p, chooseCard(p, wiki));
        return;
      }
      case "unknown": {
        if (intent.cause === "llm_error" || intent.cause === "bad_format") {
          this.log(`의도 추출 실패: ${intent.reason}`);
          await this.safePost(thread, textCard(TEXT.llmFailed));
          return;
        }
        // 잡담은 단체 대화방에서는 듣고 넘긴다. 1:1 대화방이거나 고치던 중이면 되묻는다.
        if (intent.cause === "unrelated") {
          if (thread.isDirect || ctx.wasEditing) await this.safePost(thread, textCard(TEXT.unrelated));
          return;
        }
        await this.safePost(thread, textCard(`${intent.reason}. 다시 말해 주세요.`));
        return;
      }
      default: {
        const never: never = intent;
        this.log(`알 수 없는 의도: ${JSON.stringify(never)}`);
      }
    }
  }

  /** 후보를 골랐다: 위키를 다시 읽어 변경을 만들고, 같은 카드를 확인 카드로 바꾼다 */
  private async resolvePick(p: Pending, pickId: string): Promise<void> {
    const choice = p.choice;
    if (!choice) return;
    try {
      const wiki = await this.deps.wiki.read(p.familyId);
      const r = resolveChoice({ type: "choose", kind: choice.kind, candidates: choice.candidates, patch: choice.patch, preview: p.preview }, pickId, {
        members: wiki.members,
        events: wiki.events,
        tasks: wiki.tasks,
        today: todayIn(this.now()),
      });
      // 위키를 읽는 사이에 [취소]됐으면 카드를 덮어쓰지 않는다
      if (p.status !== "confirm") return;
      if (r.type !== "change") {
        this.pending.transition(p, ["confirm"], "cancelled");
        await this.updateCard(p, textCard(`${r.type === "unknown" ? r.reason : "고를 수 없어요"}. 다시 말해 주세요.`));
        return;
      }
      p.changes = r.changes;
      p.preview = r.preview;
      await this.updateCard(p, confirmCard(p));
    } catch (e) {
      this.log(`후보 확인 실패: ${errorText(e)}`);
      if (this.pending.transition(p, ["confirm"], "cancelled")) await this.updateCard(p, textCard(TEXT.readFailed));
    }
  }

  /** 남은 변경을 앞에서부터 넣는다. 하나라도 실패하면 거기서 멈추고 [다시 시도]를 단다(넣은 것은 다시 넣지 않는다). */
  private async runApply(p: Pending): Promise<void> {
    await this.updateCard(p, textCard(`${TEXT.inserting}\n${p.preview}`));
    const syncErrors: string[] = [];
    try {
      while (p.applied < p.changes.length) {
        const change = p.changes[p.applied];
        if (!change) break;
        const r = await this.deps.wiki.apply(p.familyId, change);
        p.applied += 1;
        if (!r.synced && r.syncError) syncErrors.push(r.syncError);
      }
    } catch (e) {
      this.pending.transition(p, ["applying"], "failed");
      p.lastError = errorText(e);
      this.log(`위키 쓰기 실패(${p.id}): ${p.lastError}`);
      const done = p.applied > 0 ? `\n(앞의 ${p.applied}개는 넣었어요. 다시 시도하면 나머지만 넣어요)` : "";
      await this.updateCard(p, {
        text: `⚠️ 못 넣었어요: ${p.preview}\n원인: ${truncate(p.lastError, MAX_CAUSE)}${done}`,
        buttons: [button(p, "retry", "다시 시도", "primary"), ...(p.applied === 0 ? [button(p, "edit", "고치기")] : []), button(p, "cancel", "취소")],
      });
      return;
    }
    this.pending.transition(p, ["applying"], "done");
    await this.updateCard(p, textCard(`✅ ${p.preview}`));
    // 저장은 끝났고 원격 반영만 실패한 경우: 다시 넣으면 중복이므로 버튼 없이 알리기만 한다
    const sync = syncErrors.length ? `\n(위키 저장은 됐지만 원격 동기화는 실패했어요: ${truncate(syncErrors.join(" / "), MAX_CAUSE)})` : "";
    if (syncErrors.length) this.log(`동기화 실패(${p.id}): ${syncErrors.join(" / ")}`);
    await this.safePost(p.thread, textCard(`${TEXT.inserted}${sync}`));
  }

  private async postCard(p: Pending, card: Card): Promise<void> {
    try {
      p.card = await this.deps.ui.post(p.thread, card);
    } catch (e) {
      // 카드를 못 띄웠으면 누를 버튼도 없다 → 요청을 닫는다
      this.pending.transition(p, ["confirm", "choose"], "cancelled");
      this.log(`카드 보내기 실패(${p.id}): ${errorText(e)}`);
    }
  }

  private async updateCard(p: Pending, card: Card): Promise<void> {
    if (p.card) await this.safeUpdate(p.card.channelId, p.card.messageId, card);
  }

  private async safeUpdate(channelId: string, messageId: string, card: Card): Promise<void> {
    try {
      await this.deps.ui.update({ channelId, messageId }, card);
    } catch (e) {
      this.log(`카드 고치기 실패: ${errorText(e)}`);
    }
  }

  private async safePost(thread: Thread, card: Card): Promise<void> {
    try {
      await this.deps.ui.post(thread, card);
    } catch (e) {
      this.log(`답글 실패: ${errorText(e)}`);
    }
  }

  private async safeWhisper(thread: Thread, userId: string, text: string): Promise<void> {
    try {
      await this.deps.ui.whisper(thread, userId, text);
    } catch (e) {
      this.log(`안내 실패: ${errorText(e)}`);
    }
  }
}

function button(p: Pending, action: CardButton["action"], label: string, style?: CardButton["style"], pickId?: string): CardButton {
  return { action, label, style, pendingId: p.id, pickId };
}

/** "11/3(화) 15:00 하늘 치과 — 넣을까요?" (여러 줄이면 줄을 바꿔 묻는다) + [넣기][고치기][취소] */
export function confirmCard(p: Pending): Card {
  const text = p.preview.includes("\n") ? `${p.preview}\n${TEXT.ask}` : `${p.preview} — ${TEXT.ask}`;
  return { text, buttons: [button(p, "insert", "넣기", "primary"), button(p, "edit", "고치기"), button(p, "cancel", "취소")] };
}

/** 후보마다 버튼 하나 + [취소] */
export function chooseCard(p: Pending, wiki: Pick<WikiState, "events" | "tasks">): Card {
  const choice = p.choice;
  const ids = choice?.candidates ?? [];
  const label = (id: string): string => {
    if (choice?.kind === "task.done") return wiki.tasks.find((t) => t.id === id)?.title ?? id;
    const e = wiki.events.find((x) => x.id === id);
    return e ? `${formatWhen(e.date, e.start, e.allDay)} ${e.title}` : id;
  };
  return { text: p.preview, buttons: [...ids.map((id) => button(p, "pick", label(id), undefined, id)), button(p, "cancel", "취소")] };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
