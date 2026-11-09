import { describe, expect, it } from "vitest";
import type { Card } from "../flow/ui";
import { ACTION_PATTERN, SlackUi, escapeMrkdwn, fromSlackText, renderCard, toActionInput, toConversationMessage, type SlackChatClient } from "./messenger";

const card: Card = {
  text: "11/3(화) 15:00 하늘 치과 — 넣을까요?",
  buttons: [
    { action: "insert", label: "넣기", style: "primary", pendingId: "p1" },
    { action: "edit", label: "고치기", pendingId: "p1" },
    { action: "cancel", label: "취소", pendingId: "p1" },
  ],
};

describe("renderCard", () => {
  it("글 + 버튼 블록. action_id는 블록 안에서 겹치지 않고 등록 패턴에 맞는다", () => {
    const r = renderCard(card);
    expect(r.text).toBe(card.text);
    expect(r.blocks[0]).toEqual({ type: "section", text: { type: "mrkdwn", text: card.text } });
    const actions = r.blocks[1];
    expect(actions?.type).toBe("actions");
    if (actions?.type !== "actions") return;
    expect(actions.elements.map((e) => e.action_id)).toEqual(["hsh:insert:0", "hsh:edit:1", "hsh:cancel:2"]);
    expect(actions.elements.every((e) => ACTION_PATTERN.test(e.action_id))).toBe(true);
    expect(actions.elements[0]).toMatchObject({ value: "p1", style: "primary", text: { type: "plain_text", text: "넣기" } });
    expect(actions.elements[1]).not.toHaveProperty("style");
  });

  it("버튼이 없으면 글 블록만", () => {
    expect(renderCard({ text: "넣었어요", buttons: [] }).blocks).toHaveLength(1);
  });

  it("사용자 글의 <, >, &는 멘션·링크로 바뀌지 않게 이스케이프한다", () => {
    expect(escapeMrkdwn("<!channel> a&b <@U1>")).toBe("&lt;!channel&gt; a&amp;b &lt;@U1&gt;");
    const r = renderCard({ text: "<!here> 치과", buttons: [] });
    expect(r.blocks[0]).toMatchObject({ text: { text: "&lt;!here&gt; 치과" } });
    // 알림용 대체 글도 같은 규칙
    expect(r.text).toBe("&lt;!here&gt; 치과");
  });

  it("고르기 버튼은 값에 후보 id를 싣고, 긴 이름은 75자로 자른다", () => {
    const long = "가".repeat(100);
    const r = renderCard({ text: "어떤 일정인가요?", buttons: [{ action: "pick", label: long, pendingId: "p2", pickId: "evt-a1b2" }] });
    const el = r.blocks[1]?.type === "actions" ? r.blocks[1].elements[0] : undefined;
    expect(el?.value).toBe("p2|evt-a1b2");
    expect(el?.text.text).toHaveLength(75);
  });
});

describe("toConversationMessage", () => {
  const base = { type: "message", user: "U00MOM", text: "치과", channel: "C0FAMILY", channel_type: "channel", ts: "111.1" };
  const opts = { familyChannel: "C0FAMILY" };

  it("가족 채널 글은 그 글 아래 스레드에 답한다", () => {
    expect(toConversationMessage(base, opts)).toEqual({ userId: "U00MOM", text: "치과", thread: { channelId: "C0FAMILY", threadId: "111.1", isDirect: false } });
  });

  it("스레드 안의 글은 그 스레드에 답한다", () => {
    expect(toConversationMessage({ ...base, ts: "222.2", thread_ts: "111.1" }, opts)?.thread.threadId).toBe("111.1");
  });

  it("DM은 본문에 답하고(스레드에서 말하면 스레드에), 가족 채널 설정이 없어도 듣는다", () => {
    const dm = { ...base, channel: "D0MOM", channel_type: "im" };
    expect(toConversationMessage(dm, {})?.thread).toEqual({ channelId: "D0MOM", threadId: undefined, isDirect: true });
    expect(toConversationMessage({ ...dm, thread_ts: "1.1" }, {})?.thread.threadId).toBe("1.1");
  });

  it("파일과 함께 쓴 글, 채널에도 보낸 스레드 답글은 듣는다", () => {
    expect(toConversationMessage({ ...base, subtype: "file_share" }, opts)?.text).toBe("치과");
    expect(toConversationMessage({ ...base, subtype: "thread_broadcast", thread_ts: "1.1" }, opts)?.thread.threadId).toBe("1.1");
  });

  it("다른 채널, 가족 채널 미설정, 봇 글, 수정·삭제(subtype)는 듣지 않는다", () => {
    expect(toConversationMessage({ ...base, channel: "C0OTHER" }, opts)).toBeUndefined();
    expect(toConversationMessage(base, {})).toBeUndefined();
    expect(toConversationMessage({ ...base, bot_id: "B1" }, opts)).toBeUndefined();
    expect(toConversationMessage({ ...base, subtype: "message_changed" }, opts)).toBeUndefined();
    expect(toConversationMessage({ type: "message", channel: "C0FAMILY" }, opts)).toBeUndefined();
  });

  it("봇 멘션만 떼고(다른 사람 멘션은 @U…로 남김), 남는 글이 없으면 무시한다", () => {
    const o = { ...opts, botUserId: "U0BOT" };
    expect(toConversationMessage({ ...base, text: "<@U0BOT> 우유 사야 돼" }, o)?.text).toBe("우유 사야 돼");
    expect(toConversationMessage({ ...base, text: "<@U0BOT> <@U00DAD> 내일 치과" }, o)?.text).toBe("@U00DAD 내일 치과");
    expect(toConversationMessage({ ...base, text: "<@U0BOT>" }, o)).toBeUndefined();
  });
});

describe("fromSlackText", () => {
  it("엔티티를 원래 글자로 푼다(위키에 &amp;가 남지 않게)", () => {
    expect(fromSlackText("M&amp;M 사기 &lt;중요&gt;")).toBe("M&M 사기 <중요>");
    expect(fromSlackText("&amp;lt;")).toBe("&lt;");
  });
  it("채널·링크는 보이는 글자로, 전체 알림은 지운다", () => {
    expect(fromSlackText("<#C123|가족> <https://a.kr|안내> <https://b.kr> <!here> 확인")).toBe("#가족 안내 https://b.kr 확인");
  });
  it("이름이 붙은 멘션도 id로 읽는다", () => {
    expect(fromSlackText("<@U00DAD|dad> 치과", "U0BOT")).toBe("@U00DAD 치과");
  });
});

describe("toActionInput", () => {
  const body = {
    type: "block_actions",
    user: { id: "U00MOM" },
    channel: { id: "C0FAMILY" },
    message: { ts: "333.3", thread_ts: "111.1" },
    actions: [{ action_id: "hsh:insert:0", value: "p1" }],
  };

  it("버튼 이름·요청 id·누른 사람·카드 주소를 읽는다", () => {
    expect(toActionInput(body)).toEqual({
      action: "insert",
      pendingId: "p1",
      pickId: undefined,
      userId: "U00MOM",
      thread: { channelId: "C0FAMILY", threadId: "111.1", isDirect: false },
      card: { channelId: "C0FAMILY", messageId: "333.3" },
    });
  });

  it("고르기 버튼은 후보 id를 함께 읽는다", () => {
    expect(toActionInput({ ...body, actions: [{ action_id: "hsh:pick:1", value: "p2|evt-a1b2" }] })).toMatchObject({ action: "pick", pendingId: "p2", pickId: "evt-a1b2" });
  });

  it("이 봇의 버튼이 아니거나 모르는 이름·빈 값·틀린 모양이면 undefined", () => {
    expect(toActionInput({ ...body, actions: [{ action_id: "other:insert", value: "p1" }] })).toBeUndefined();
    expect(toActionInput({ ...body, actions: [{ action_id: "hsh:delete_all:0", value: "p1" }] })).toBeUndefined();
    expect(toActionInput({ ...body, actions: [{ action_id: "hsh:insert:0" }] })).toBeUndefined();
    expect(toActionInput({ ...body, channel: undefined })).toBeUndefined();
    expect(toActionInput({ type: "view_submission" })).toBeUndefined();
  });
});

describe("SlackUi", () => {
  function fakeClient() {
    const calls: { method: string; args: unknown }[] = [];
    const client: SlackChatClient = {
      chat: {
        async postMessage(args) {
          calls.push({ method: "postMessage", args });
          return { ok: true, ts: "999.9", channel: args.channel };
        },
        async update(args) {
          calls.push({ method: "update", args });
          return {};
        },
        async postEphemeral(args) {
          calls.push({ method: "postEphemeral", args });
          return {};
        },
      },
    };
    return { client, calls };
  }

  it("스레드가 있으면 thread_ts로 달고, 보낸 메시지 주소를 돌려준다", async () => {
    const { client, calls } = fakeClient();
    const ui = new SlackUi(async () => client);
    const ref = await ui.post({ channelId: "C0FAMILY", threadId: "111.1", isDirect: false }, card);
    expect(ref).toEqual({ channelId: "C0FAMILY", messageId: "999.9" });
    expect(calls[0]).toMatchObject({ method: "postMessage", args: { channel: "C0FAMILY", thread_ts: "111.1", text: card.text } });
  });

  it("DM 본문에는 thread_ts 없이 보낸다", async () => {
    const { client, calls } = fakeClient();
    await new SlackUi(async () => client).post({ channelId: "D0MOM", isDirect: true }, { text: "안녕", buttons: [] });
    expect(calls[0]?.args).not.toHaveProperty("thread_ts");
  });

  it("카드 고치기는 chat.update, 본인 안내는 chat.postEphemeral", async () => {
    const { client, calls } = fakeClient();
    const ui = new SlackUi(async () => client);
    await ui.update({ channelId: "C0FAMILY", messageId: "333.3" }, { text: "✅ 치과", buttons: [] });
    await ui.whisper({ channelId: "C0FAMILY", threadId: "111.1", isDirect: false }, "U00DAD", "요청한 분만 누를 수 있어요.");
    expect(calls.map((c) => c.method)).toEqual(["update", "postEphemeral"]);
    expect(calls[0]?.args).toMatchObject({ channel: "C0FAMILY", ts: "333.3", text: "✅ 치과" });
    expect(calls[1]?.args).toEqual({ channel: "C0FAMILY", user: "U00DAD", text: "요청한 분만 누를 수 있어요.", thread_ts: "111.1" });
  });

  it("ts를 받지 못하면 던진다(흐름이 요청을 닫는다)", async () => {
    const client: SlackChatClient = { chat: { postMessage: async () => ({ ok: true }), update: async () => ({}), postEphemeral: async () => ({}) } };
    await expect(new SlackUi(async () => client).post({ channelId: "C1", isDirect: false }, card)).rejects.toThrow("ts");
  });
});
