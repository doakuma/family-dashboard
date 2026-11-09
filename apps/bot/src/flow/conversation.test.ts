import { DEFAULT_FAMILY_ID, type Change, type Event, type LlmAdapter, type LlmRequest, type Member, type Task, type WikiState, type WriteResult } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { Conversation, TEXT } from "./conversation";
import { PENDING_TTL_MS, PendingStore } from "./pending";
import type { ActionInput, ActionName, Card, ConversationMessage, ConversationUi, MessageRef, Thread } from "./ui";

const members: Member[] = [
  { id: "mom", name: "엄마", role: "guardian", color: "coral", slackId: "U00MOM" },
  { id: "dad", name: "아빠", role: "guardian", color: "green", slackId: "U00DAD" },
  { id: "haneul", name: "하늘", role: "child", color: "blue" },
];
const events: Event[] = [
  { id: "evt-a1b2", date: "2026-11-03", start: "15:00", end: "16:00", allDay: false, title: "치과", members: ["haneul"], done: false },
  { id: "evt-c3d4", date: "2026-11-05", start: "15:00", allDay: false, title: "치과", members: ["mom"], done: false },
];
const tasks: Task[] = [{ id: "task-e5f6", list: "shopping", title: "우유", done: false }];
// 2026-10-29(목) 22:00 서울
const NOW = new Date("2026-10-29T13:00:00Z");

const wikiState = (): WikiState => ({ familyId: DEFAULT_FAMILY_ID, skin: "default", character: "none", members, events, tasks, anniversaries: [], warnings: [] });

/** 위키: 읽기는 고정 상태, 쓰기는 기록. failAt 번째(0부터) apply는 던진다 */
function fakeWiki(opts: { failAt?: number[]; synced?: boolean; readError?: boolean } = {}) {
  const applied: Change[] = [];
  let calls = 0;
  return {
    applied,
    async read() {
      if (opts.readError) throw new Error("디스크 오류");
      return wikiState();
    },
    async apply(_f: unknown, change: Change): Promise<WriteResult> {
      const n = calls++;
      if (opts.failAt?.includes(n)) throw new Error("커밋 실패: index.lock");
      applied.push(change);
      return opts.synced === false ? { version: `v${n}`, synced: false, syncError: "push 거부" } : { version: `v${n}`, synced: true };
    },
  };
}

/** 받은 순서대로 응답하는 가짜 LLM. 받은 user 글을 기록한다 */
function fakeLlm(...outs: unknown[]): LlmAdapter & { users: string[] } {
  const users: string[] = [];
  return {
    name: "fake",
    users,
    async json(req: LlmRequest) {
      users.push(req.user);
      const o = outs.shift();
      if (o instanceof Error) throw o;
      return o;
    },
  };
}

interface Sent {
  kind: "post" | "update" | "whisper";
  ref?: MessageRef;
  thread?: Thread;
  card?: Card;
  text?: string;
  user?: string;
}

function fakeUi(opts: { failPost?: boolean } = {}): ConversationUi & { sent: Sent[]; last(): Sent } {
  const sent: Sent[] = [];
  let n = 0;
  return {
    sent,
    last: () => sent[sent.length - 1] as Sent,
    async post(thread, card) {
      if (opts.failPost) throw new Error("channel_not_found");
      const ref = { channelId: thread.channelId, messageId: `m${++n}` };
      sent.push({ kind: "post", ref, thread, card });
      return ref;
    },
    async update(ref, card) {
      sent.push({ kind: "update", ref, card });
    },
    async whisper(thread, user, text) {
      sent.push({ kind: "whisper", thread, user, text });
    },
  };
}

const CHANNEL: Thread = { channelId: "C0FAMILY", threadId: "111.1", isDirect: false };
const DM: Thread = { channelId: "D0MOM", isDirect: true };
const say = (text: string, thread: Thread = CHANNEL, userId = "U00MOM"): ConversationMessage => ({ userId, text, thread });

function setup(opts: { wiki?: ReturnType<typeof fakeWiki>; llm: ReturnType<typeof fakeLlm>; ui?: ReturnType<typeof fakeUi>; pending?: PendingStore }) {
  const wiki = opts.wiki ?? fakeWiki();
  const ui = opts.ui ?? fakeUi();
  const logs: string[] = [];
  const conv = new Conversation({ wiki, llm: opts.llm, ui, familyId: DEFAULT_FAMILY_ID, pending: opts.pending, now: () => NOW, log: (m) => logs.push(m) });
  /** 마지막으로 보낸 카드의 버튼을 누른다 */
  const press = (action: ActionName, opt: { userId?: string; label?: string; card?: Card } = {}) => {
    const card = opt.card ?? lastCard(ui);
    const b = card.buttons.find((x) => x.action === action && (!opt.label || x.label.includes(opt.label)));
    if (!b) throw new Error(`버튼 없음: ${action}`);
    const ref = [...ui.sent].reverse().find((s) => s.kind === "post" && s.card?.buttons.some((x) => x.pendingId === b.pendingId))?.ref;
    const a: ActionInput = { action, pendingId: b.pendingId, pickId: b.pickId, userId: opt.userId ?? "U00MOM", thread: CHANNEL, card: ref };
    return conv.handleAction(a);
  };
  return { conv, wiki, ui, logs, press };
}

function lastCard(ui: ReturnType<typeof fakeUi>): Card {
  const s = [...ui.sent].reverse().find((x) => x.card && x.card.buttons.length > 0);
  if (!s?.card) throw new Error("버튼 카드 없음");
  return s.card;
}
const actions = (c?: Card) => c?.buttons.map((b) => b.action);

const ADD = { intent: "event.add", date: "2026-11-03", start: "15:00", title: "치과", members: ["haneul"] };
const ADD_CHANGE: Change = { kind: "event.add", payload: { date: "2026-11-03", start: "15:00", end: undefined, allDay: false, title: "치과", members: ["haneul"] } };

describe("쓰기 확인 흐름", () => {
  it("미리보기 + [넣기][고치기][취소] → 넣기 → 위키 쓰기 → 카드 ✅ + 스레드에 '넣었어요'", async () => {
    const { conv, wiki, ui, press } = setup({ llm: fakeLlm(ADD) });
    await conv.handleMessage(say("다음 주 화요일 3시 하늘 치과"));

    const card = ui.last();
    expect(card).toMatchObject({ kind: "post", thread: CHANNEL });
    expect(card.card?.text).toBe("11/3(화) 15:00 하늘 치과 — 넣을까요?");
    expect(actions(card.card)).toEqual(["insert", "edit", "cancel"]);
    expect(card.card?.buttons.map((b) => b.label)).toEqual(["넣기", "고치기", "취소"]);
    expect(wiki.applied).toEqual([]);

    await press("insert");
    expect(wiki.applied).toEqual([ADD_CHANGE]);
    const after = ui.sent.slice(1);
    expect(after.map((s) => s.kind)).toEqual(["update", "update", "post"]);
    expect(after[0]?.card?.text).toContain(TEXT.inserting);
    expect(after[1]).toMatchObject({ ref: card.ref, card: { text: "✅ 11/3(화) 15:00 하늘 치과", buttons: [] } });
    expect(after[2]).toMatchObject({ thread: CHANNEL, card: { text: "넣었어요", buttons: [] } });
  });

  it("넣기를 두 번(동시에) 눌러도 한 번만 쓴다", async () => {
    const { conv, wiki, press } = setup({ llm: fakeLlm(ADD) });
    await conv.handleMessage(say("치과"));
    await Promise.all([press("insert"), press("insert")]);
    expect(wiki.applied).toHaveLength(1);
  });

  it("요청한 사람이 아니면 누를 수 없다(본인에게만 안내)", async () => {
    const { conv, wiki, ui, press } = setup({ llm: fakeLlm(ADD) });
    await conv.handleMessage(say("치과"));
    await press("insert", { userId: "U00DAD" });
    expect(wiki.applied).toEqual([]);
    expect(ui.last()).toMatchObject({ kind: "whisper", user: "U00DAD", text: TEXT.notOwner });
    // 본인은 그 뒤에도 넣을 수 있다
    await press("insert");
    expect(wiki.applied).toHaveLength(1);
  });

  it("취소하면 버튼이 사라지고, 그 뒤 넣기는 무시된다", async () => {
    const { conv, wiki, ui, press } = setup({ llm: fakeLlm(ADD) });
    await conv.handleMessage(say("치과"));
    const card = lastCard(ui);
    await press("cancel");
    expect(ui.last()).toMatchObject({ kind: "update", card: { text: "취소했어요: 11/3(화) 15:00 하늘 치과", buttons: [] } });
    await press("insert", { card });
    expect(wiki.applied).toEqual([]);
  });

  it("장보기 여러 개는 카드 하나로 묻고 한 번에 넣는다", async () => {
    const { conv, wiki, ui, press } = setup({
      llm: fakeLlm({ intent: "task.add", items: [{ list: "shopping", title: "우유" }, { list: "shopping", title: "사과" }] }),
    });
    await conv.handleMessage(say("우유랑 사과 사야 돼"));
    expect(ui.last().card?.text).toBe("🛒 장보기: 우유\n🛒 장보기: 사과\n넣을까요?");
    await press("insert");
    expect(wiki.applied.map((c) => c.kind === "task.add" && c.payload.title)).toEqual(["우유", "사과"]);
  });
});

describe("실패와 다시 시도", () => {
  it("쓰기가 실패하면 원인과 [다시 시도]를 달고, 다시 시도하면 넣는다", async () => {
    const wiki = fakeWiki({ failAt: [0] });
    const { conv, ui, press, logs } = setup({ wiki, llm: fakeLlm(ADD) });
    await conv.handleMessage(say("치과"));
    await press("insert");
    const failed = ui.last();
    expect(failed.kind).toBe("update");
    expect(failed.card?.text).toBe("⚠️ 못 넣었어요: 11/3(화) 15:00 하늘 치과\n원인: 커밋 실패: index.lock");
    expect(actions(failed.card)).toEqual(["retry", "edit", "cancel"]);
    expect(logs.some((l) => l.includes("index.lock"))).toBe(true);

    await press("retry");
    expect(wiki.applied).toEqual([ADD_CHANGE]);
    expect(ui.last().card?.text).toBe("넣었어요");
  });

  it("여러 개 중 일부만 넣고 실패하면, 다시 시도는 남은 것만 넣는다(고치기는 없다)", async () => {
    const wiki = fakeWiki({ failAt: [1] });
    const { conv, ui, press } = setup({
      wiki,
      llm: fakeLlm({ intent: "task.add", items: [{ list: "shopping", title: "우유" }, { list: "shopping", title: "사과" }] }),
    });
    await conv.handleMessage(say("우유랑 사과"));
    await press("insert");
    expect(wiki.applied).toHaveLength(1);
    const failed = ui.last().card;
    expect(failed?.text).toContain("앞의 1개는 넣었어요");
    expect(actions(failed)).toEqual(["retry", "cancel"]);
    await press("retry");
    expect(wiki.applied.map((c) => c.kind === "task.add" && c.payload.title)).toEqual(["우유", "사과"]);
  });

  it("저장은 됐고 원격 동기화만 실패하면 다시 시도 없이 알린다", async () => {
    const { conv, ui, press } = setup({ wiki: fakeWiki({ synced: false }), llm: fakeLlm(ADD) });
    await conv.handleMessage(say("치과"));
    await press("insert");
    expect(ui.last().card).toEqual({ text: "넣었어요\n(위키 저장은 됐지만 원격 동기화는 실패했어요: push 거부)", buttons: [] });
  });
});

describe("고치기", () => {
  it("고칠 내용을 스레드에 보내면 처음 말과 합쳐 다시 묻고, 처음 카드는 닫는다", async () => {
    const llm = fakeLlm(ADD, { ...ADD, start: "16:00" });
    const { conv, wiki, ui, press } = setup({ llm });
    await conv.handleMessage(say("다음 주 화요일 3시 하늘 치과"));
    const first = ui.sent[0];
    await press("edit");
    expect(ui.last()).toMatchObject({ kind: "update", ref: first?.ref });
    expect(ui.last().card?.text).toContain(TEXT.editing);
    expect(actions(ui.last().card)).toEqual(["cancel"]);

    await conv.handleMessage(say("4시로"));
    expect(llm.users[1]).toBe("다음 주 화요일 3시 하늘 치과\n고친 내용: 4시로");
    const closed = ui.sent.find((s) => s.kind === "update" && s.card?.text.startsWith(TEXT.edited));
    expect(closed).toMatchObject({ ref: first?.ref, card: { buttons: [] } });
    expect(ui.last().card?.text).toBe("11/3(화) 16:00 하늘 치과 — 넣을까요?");

    // 처음 카드의 넣기는 더 이상 안 된다
    await press("insert", { card: first?.card });
    expect(wiki.applied).toEqual([]);
    await press("insert");
    expect(wiki.applied).toMatchObject([{ kind: "event.add", payload: { start: "16:00" } }]);
  });

  it("다른 스레드나 다른 사람의 글은 고친 내용으로 보지 않는다", async () => {
    const llm = fakeLlm(ADD, ADD, ADD);
    const { conv, press } = setup({ llm });
    await conv.handleMessage(say("치과"));
    await press("edit");
    await conv.handleMessage(say("4시로", { ...CHANNEL, threadId: "222.2" }));
    await conv.handleMessage(say("4시로", CHANNEL, "U00DAD"));
    expect(llm.users.slice(1)).toEqual(["4시로", "4시로"]);
  });
});

describe("후보 고르기", () => {
  it("대상이 여럿이면 후보 버튼을 띄우고, 고르면 같은 카드가 확인 카드로 바뀐다", async () => {
    const { conv, wiki, ui, press } = setup({ llm: fakeLlm({ intent: "event.update", targetIds: ["evt-a1b2", "evt-c3d4"], start: "16:00" }) });
    await conv.handleMessage(say("치과 4시로 바꿔줘"));
    const card = ui.last();
    expect(card.card?.text).toBe("어떤 일정인가요?");
    expect(card.card?.buttons.map((b) => [b.action, b.label])).toEqual([
      ["pick", "11/3(화) 15:00 치과"],
      ["pick", "11/5(목) 15:00 치과"],
      ["cancel", "취소"],
    ]);

    await press("pick", { label: "11/3" });
    expect(ui.last()).toMatchObject({ kind: "update", ref: card.ref });
    expect(ui.last().card?.text).toBe("치과: 11/3(화) 15:00 → 11/3(화) 16:00 — 넣을까요?");
    await press("insert");
    // 원래 길이(1시간)를 유지해 끝 시간을 계산한다
    expect(wiki.applied).toEqual([{ kind: "event.update", payload: { id: "evt-a1b2", start: "16:00", allDay: false, end: "17:00" } }]);
  });

  it("후보가 너무 많으면 더 구체적으로 말해 달라고 한다", async () => {
    const base: Event = { id: "", date: "2026-11-03", start: "15:00", allDay: false, title: "치과", members: ["haneul"], done: false };
    const many: Event[] = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `evt-000${i}` }));
    const wiki = { ...fakeWiki(), read: async () => ({ ...wikiState(), events: many }) };
    const { conv, ui } = setup({ wiki, llm: fakeLlm({ intent: "event.remove", targetIds: many.map((e) => e.id) }) });
    await conv.handleMessage(say("치과 지워줘"));
    expect(ui.last().card).toEqual({ text: TEXT.tooMany, buttons: [] });
  });
});

describe("질문·잡담·실패", () => {
  it("질문은 쓰기 없이 위키로 답한다", async () => {
    const { conv, wiki, ui } = setup({ llm: fakeLlm({ intent: "question", qFrom: "2026-11-03", qTo: "2026-11-03" }) });
    await conv.handleMessage(say("다음 주 화요일 뭐 있어?"));
    expect(wiki.applied).toEqual([]);
    expect(ui.last().card?.text).toContain("치과");
    expect(ui.last().card?.buttons).toEqual([]);
  });

  it("잡담은 가족 채널에서는 넘기고, DM에서는 되묻는다", async () => {
    const { conv, ui } = setup({ llm: fakeLlm({ intent: "unknown" }, { intent: "unknown" }) });
    await conv.handleMessage(say("ㅋㅋㅋ 오늘 날씨 좋다"));
    expect(ui.sent).toEqual([]);
    await conv.handleMessage(say("안녕", DM));
    expect(ui.last()).toMatchObject({ thread: DM, card: { text: TEXT.unrelated } });
  });

  it("내용 문제(날짜를 모름)는 이유와 함께 되묻는다", async () => {
    const { conv, ui } = setup({ llm: fakeLlm({ intent: "event.add", title: "치과" }) });
    await conv.handleMessage(say("치과 가야 돼"));
    expect(ui.last().card?.text).toBe("날짜를 알 수 없어요. 다시 말해 주세요.");
  });

  it("LLM 호출이 실패하면 연결 문제라고 알린다", async () => {
    const { conv, ui, logs } = setup({ llm: fakeLlm(new Error("timeout")) });
    await conv.handleMessage(say("치과"));
    expect(ui.last().card?.text).toBe(TEXT.llmFailed);
    expect(logs[0]).toContain("timeout");
  });

  it("위키를 못 읽으면 알리고 LLM은 부르지 않는다", async () => {
    const llm = fakeLlm(ADD);
    const { conv, ui } = setup({ wiki: fakeWiki({ readError: true }), llm });
    await conv.handleMessage(say("치과"));
    expect(ui.last().card?.text).toBe(TEXT.readFailed);
    expect(llm.users).toEqual([]);
  });

  it("빈 글은 무시한다", async () => {
    const llm = fakeLlm();
    const { conv, ui } = setup({ llm });
    await conv.handleMessage(say("   "));
    expect(ui.sent).toEqual([]);
    expect(llm.users).toEqual([]);
  });

  it("메신저 보내기가 실패해도 던지지 않고 로그를 남긴다", async () => {
    const { conv, logs } = setup({ llm: fakeLlm(ADD), ui: fakeUi({ failPost: true }) });
    await expect(conv.handleMessage(say("치과"))).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("channel_not_found"))).toBe(true);
  });
});

describe("시간이 지난 버튼", () => {
  it("보관소에 없는 요청(재시작·만료)의 버튼은 카드를 '시간이 지났어요'로 바꾼다", async () => {
    let t = 0;
    const pending = new PendingStore(() => t);
    const { conv, wiki, ui, press } = setup({ llm: fakeLlm(ADD), pending });
    await conv.handleMessage(say("치과"));
    const ref = ui.last().ref;
    t = PENDING_TTL_MS + 1;
    await press("insert");
    expect(wiki.applied).toEqual([]);
    expect(ui.last()).toEqual({ kind: "update", ref, card: { text: TEXT.expired, buttons: [] } });
  });
});
