import { SettingsError, asFamilyId, type Member, type SettingsChange, type WikiState } from "@hsh/core";
import { describe, expect, it } from "vitest";
import type { ActionInput, Card, ConversationMessage, ConversationUi, MessageRef, Thread } from "../flow/ui";
import { SETTINGS_TEXT, SettingsCommandHandler, euro, iyeyo, isSettingsPendingId } from "./handler";
import { SettingsPendingStore } from "./pending";

const FID = asFamilyId("default");
const dm: Thread = { channelId: "D1", isDirect: true };
const chan: Thread = { channelId: "C1", threadId: "1.1", isDirect: false };
const say = (text: string, userId = "U0MOM", thread: Thread = chan): ConversationMessage => ({ text, userId, thread });

const mom: Member = { id: "mom", name: "엄마", role: "guardian", color: "coral", slackId: "U0MOM" };
const sky: Member = { id: "haneul", name: "하늘", role: "child", color: "blue", slackId: "U0SKY" };
const dad: Member = { id: "dad", name: "아빠", role: "guardian", color: "teal" };
const family: Member = { id: "family", name: "가족", role: "guardian", color: "gray" };

function setup(initial: Member[] = [mom, sky, dad, family]) {
  let members = initial;
  const calls: { change: SettingsChange; author?: string }[] = [];
  const reads = { n: 0, fail: false };
  let applyError: unknown;
  let sync: { synced: boolean; syncError?: string } = { synced: true };
  const wiki = {
    async read(): Promise<WikiState> {
      reads.n++;
      if (reads.fail) throw new Error("읽기 실패");
      return { familyId: FID, skin: "default", character: "none", members, events: [], tasks: [], anniversaries: [], warnings: [] };
    },
    async applySettings(_id: unknown, change: SettingsChange, opts?: { author?: string }) {
      if (applyError) throw applyError;
      calls.push({ change, author: opts?.author });
      return { version: "v1", ...sync };
    },
  };
  const posted: { thread: Thread; card: Card }[] = [];
  const updates: { ref: MessageRef; card: Card }[] = [];
  const whispers: { userId: string; text: string }[] = [];
  const ui: ConversationUi = {
    async post(thread, card) {
      posted.push({ thread, card });
      return { channelId: thread.channelId, messageId: `m${posted.length}` };
    },
    async update(ref, card) {
      updates.push({ ref, card });
    },
    async whisper(_t, userId, text) {
      whispers.push({ userId, text });
    },
  };
  const store = new SettingsPendingStore();
  const h = new SettingsCommandHandler({ wiki, ui, familyId: FID, pending: store, log: () => {} });
  const lastCard = () => posted.at(-1)?.card;
  const press = (action: ActionInput["action"], userId = "U0MOM", pendingId?: string): Promise<void> => {
    const id = pendingId ?? lastCard()?.buttons[0]?.pendingId ?? "";
    return h.handleAction({ action, pendingId: id, userId, thread: chan, card: { channelId: "C1", messageId: "m1" } });
  };
  return {
    h, wiki, ui, calls, reads, posted, updates, whispers, store, lastCard, press,
    setMembers: (m: Member[]) => (members = m),
    failApply: (e: unknown) => (applyError = e),
    setSync: (r: { synced: boolean; syncError?: string }) => (sync = r),
    lastUpdate: () => updates.at(-1)?.card.text,
  };
}

describe("한국어 조사 도우미", () => {
  it("으로/로, 이에요/예요", () => {
    expect(["산호", "청록", "파랑", "호박", "초록", "보라", "분홍"].map(euro)).toEqual(["로", "으로", "으로", "으로", "으로", "로", "으로"]);
    expect(["산호", "보라", "초록"].map(iyeyo)).toEqual(["예요", "예요", "이에요"]);
  });
});

describe("미리보기", () => {
  it("보호자가 말하면 '하늘 색을 파랑 → 초록으로 바꿀까요?' + [바꾸기][취소], 아직 쓰지 않는다", async () => {
    const t = setup();
    expect(await t.h.tryHandle(say("하늘이 색 초록으로 바꿔줘"))).toBe(true);
    expect(t.lastCard()?.text).toBe("하늘 색을 파랑 → 초록으로 바꿀까요?");
    expect(t.lastCard()?.buttons.map((b) => [b.action, b.label])).toEqual([["insert", "바꾸기"], ["cancel", "취소"]]);
    expect(isSettingsPendingId(t.lastCard()?.buttons[0]?.pendingId ?? "")).toBe(true);
    expect(t.calls).toHaveLength(0);
  });
  it("채널은 스레드에, DM은 그 대화에 답한다", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    await t.h.tryHandle(say("아빠 색 보라로 바꿔줘", "U0MOM", dm));
    expect(t.posted.map((p) => p.thread)).toEqual([chan, dm]);
  });
  it("버튼 값(요청 id)에는 색·이름이 들어 있지 않다", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    expect(t.lastCard()?.buttons[0]?.pendingId).toMatch(/^s_[a-z0-9]+$/);
  });
  it("가족 전체(family)·모르는 이름·명령이 아닌 글은 가로채지 않는다(false)", async () => {
    const t = setup();
    for (const text of ["벽 색 초록으로 바꿔줘", "가족 색 초록으로 바꿔줘", "하늘이 색종이 사야 돼", "다음 주 화요일 3시 치과"]) expect(await t.h.tryHandle(say(text)), text).toBe(false);
    expect(t.posted).toHaveLength(0);
  });
  it("명령 모양이 아니면 위키를 읽지도 않는다", async () => {
    const t = setup();
    await t.h.tryHandle(say("우유 사야 돼"));
    expect(t.reads.n).toBe(0);
  });
  it("같은 색이면 버튼 없이 '이미 초록이에요'", async () => {
    const t = setup([mom, { ...sky, color: "green" }, dad, family]);
    expect(await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"))).toBe(true);
    expect(t.lastCard()).toEqual({ text: "하늘 색은 이미 초록이에요.", buttons: [] });
    expect(t.store.get("x")).toBeUndefined();
  });
  it("모르는 색이면 가능한 색 목록을 안내(버튼 없음)", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 빨강으로 바꿔줘"));
    expect(t.lastCard()?.buttons).toEqual([]);
    expect(t.lastCard()?.text).toContain("'빨강'");
    for (const c of ["산호", "청록", "파랑", "호박", "초록", "보라", "분홍"]) expect(t.lastCard()?.text).toContain(c);
  });
  it("모호한 이름은 후보를 말하고 끝(버튼 없음)", async () => {
    const t = setup([mom, { ...sky, id: "m1", name: "김민준" }, { ...dad, id: "m2", name: "박민준" }, family]);
    await t.h.tryHandle(say("민준 색 초록으로 바꿔줘"));
    expect(t.lastCard()).toEqual({ text: SETTINGS_TEXT.ambiguous("민준", ["김민준", "박민준"]), buttons: [] });
    expect(t.calls).toHaveLength(0);
  });
  it("슬랙 멘션(@U…)으로 지정", async () => {
    const t = setup();
    await t.h.tryHandle(say("@U0SKY 색 초록으로 바꿔줘"));
    expect(t.lastCard()?.text).toContain("하늘 색을");
  });
});

describe("권한: 보호자만 (apply 0회)", () => {
  it("아이는 안내만 받고 요청이 만들어지지 않는다", async () => {
    const t = setup();
    expect(await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘", "U0SKY"))).toBe(true);
    expect(t.lastCard()).toEqual({ text: SETTINGS_TEXT.childNoSettings, buttons: [] });
    expect(t.calls).toHaveLength(0);
  });
  it("미등록 사용자·role 누락은 안내만", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘", "U0STRANGER"));
    expect(t.lastCard()?.text).toBe(SETTINGS_TEXT.unregistered);
    const noRole = { ...mom, role: undefined as never };
    t.setMembers([noRole, sky, family]);
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    expect(t.lastCard()?.text).toBe(SETTINGS_TEXT.childNoSettings);
    expect(t.calls).toHaveLength(0);
  });
  it("권한이 없는 사람에게는 모르는 색·같은 색 안내보다 권한 안내가 먼저", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 빨강으로 바꿔줘", "U0SKY"));
    expect(t.lastCard()?.text).toBe(SETTINGS_TEXT.childNoSettings);
  });
  it("위키를 읽지 못하면 안내하고 쓰지 않는다", async () => {
    const t = setup();
    t.reads.fail = true;
    expect(await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"))).toBe(true);
    expect(t.lastCard()?.text).toBe(SETTINGS_TEXT.readFailed);
    expect(t.calls).toHaveLength(0);
  });
});

describe("버튼", () => {
  it("[바꾸기]: 위키를 다시 읽고 member.color 한 번, 작성자는 구성원 이름(슬랙 ID 아님), 카드 ✅", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    const readsBefore = t.reads.n;
    await t.press("insert");
    expect(t.reads.n).toBeGreaterThan(readsBefore);
    expect(t.calls).toEqual([{ change: { kind: "member.color", payload: { id: "haneul", color: "green" } }, author: "slack:엄마" }]);
    expect(t.updates.map((u) => u.card.text)).toEqual([expect.stringContaining("⏳"), "✅ 하늘 색을 파랑 → 초록으로 바꿨어요"]);
    expect(t.updates.every((u) => u.card.buttons.length === 0)).toBe(true);
    expect(JSON.stringify(t.calls)).not.toContain("U0MOM");
  });
  it("두 번 눌러도 한 번만 쓴다", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    await Promise.all([t.press("insert"), t.press("insert")]);
    await t.press("insert");
    expect(t.calls).toHaveLength(1);
  });
  it("요청한 사람만 누를 수 있다(다른 사람은 본인에게만 안내, 쓰지 않음)", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    await t.press("insert", "U0SKY");
    expect(t.whispers).toEqual([{ userId: "U0SKY", text: SETTINGS_TEXT.notOwner }]);
    expect(t.calls).toHaveLength(0);
    await t.press("insert"); // 요청자는 여전히 누를 수 있다
    expect(t.calls).toHaveLength(1);
  });
  it("[취소]: 쓰지 않고, 이후 [바꾸기]는 무시", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    await t.press("cancel");
    await t.press("insert");
    expect(t.calls).toHaveLength(0);
    expect(t.lastUpdate()).toBe("취소했어요: 하늘 색을 초록으로 바꾸기");
  });
  it("보호자가 아니게 된 뒤 누르면 안 쓴다(버튼 시점 재판정): 강등·연결 해제", async () => {
    const a = setup();
    await a.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    a.setMembers([{ ...mom, role: "child" }, sky, dad, family]);
    await a.press("insert");
    expect(a.calls).toHaveLength(0);
    expect(a.lastUpdate()).toBe(SETTINGS_TEXT.childNoSettings);

    const b = setup();
    await b.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    b.setMembers([{ ...mom, slackId: undefined }, sky, dad, family]);
    await b.press("insert");
    expect(b.calls).toHaveLength(0);
    expect(b.lastUpdate()).toBe(SETTINGS_TEXT.unregistered);
  });
  it("그 사이 구성원 목록이 바뀌어 대상이 없어지면 안 쓰고 안내", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    t.setMembers([mom, dad, family]);
    await t.press("insert");
    expect(t.calls).toHaveLength(0);
    expect(t.lastUpdate()).toBe(SETTINGS_TEXT.gone);
  });
  it("그 사이 이미 같은 색이 되었으면 쓰지 않고 '이미 …'", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    t.setMembers([mom, { ...sky, color: "green" }, dad, family]);
    await t.press("insert");
    expect(t.calls).toHaveLength(0);
    expect(t.lastUpdate()).toBe("하늘 색은 이미 초록이에요.");
  });
  it("버튼 시점 위키 읽기 실패는 요청을 닫지 않고 되돌려, 다시 누르면 쓴다", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    t.reads.fail = true;
    await t.press("insert");
    expect(t.calls).toHaveLength(0);
    expect(t.updates.at(-1)?.card.text).toContain(SETTINGS_TEXT.readRetry);
    expect(t.updates.at(-1)?.card.buttons.map((b) => b.action)).toEqual(["insert", "cancel"]);
    t.reads.fail = false;
    await t.press("insert");
    expect(t.calls).toHaveLength(1);
  });
  it("쓰기 실패는 카드에 원인 + [다시 시도][취소], 다시 시도하면 쓴다", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    t.failApply(new Error("git 오류"));
    await t.press("insert");
    const failed = t.updates.at(-1)?.card;
    expect(failed?.text).toContain("git 오류");
    expect(failed?.buttons.map((b) => b.action)).toEqual(["retry", "cancel"]);
    t.failApply(undefined);
    await t.press("retry");
    expect(t.calls).toHaveLength(1);
  });
  it("저장소가 대상 없음(not_found)을 알리면 닫고 안내", async () => {
    const t = setup();
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    t.failApply(new SettingsError("없음", "not_found"));
    await t.press("insert");
    expect(t.lastUpdate()).toBe(SETTINGS_TEXT.gone);
  });
  it("모르는·만료된 요청 id의 버튼은 '시간이 지났어요'로 카드를 바꾼다", async () => {
    const t = setup();
    await t.press("insert", "U0MOM", "s_nothing");
    expect(t.lastUpdate()).toBe(SETTINGS_TEXT.expired);
    expect(t.calls).toHaveLength(0);
  });
  it("24시간이 지나면 요청이 만료돼 버튼이 '시간이 지났어요'가 된다", async () => {
    let now = 1_000_000;
    const t = setup();
    const store = new SettingsPendingStore(() => now);
    const h = new SettingsCommandHandler({ wiki: t.wiki, ui: t.ui, familyId: FID, pending: store, log: () => {} });
    await h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    const id = t.lastCard()?.buttons[0]?.pendingId ?? "";
    now += 24 * 60 * 60 * 1000 + 1;
    await h.handleAction({ action: "insert", pendingId: id, userId: "U0MOM", thread: chan, card: { channelId: "C1", messageId: "m1" } });
    expect(t.calls).toHaveLength(0);
    expect(t.lastUpdate()).toBe(SETTINGS_TEXT.expired);
  });
  it("동기화만 실패하면 저장됐다고 알린다(버튼 없이)", async () => {
    const t = setup();
    t.setSync({ synced: false, syncError: "push 거부" });
    await t.h.tryHandle(say("하늘 색 초록으로 바꿔줘"));
    await t.press("insert");
    expect(t.calls).toHaveLength(1);
    expect(t.updates.at(-1)?.card.text).toContain("원격 동기화는 실패했어요: push 거부");
    expect(t.updates.at(-1)?.card.buttons).toEqual([]);
  });
});
