import { FsWikiRepository } from "@hsh/core/node";
import { asFamilyId, type Anniversary, type Event, type LlmAdapter, type Member, type Task } from "@hsh/core";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { answerQuestion } from "./answer";
import { buildSystemPrompt } from "./prompt";
import { NO_ANSWER } from "./question";

const members: Member[] = [
  { id: "mom", name: "엄마", role: "guardian", color: "coral", slackId: "U00MOM" },
  { id: "haneul", name: "하늘", role: "child", color: "blue" },
  { id: "family", name: "가족", role: "guardian", color: "gray" },
];
const events: Event[] = [
  { id: "evt-0001", date: "2026-10-31", allDay: true, title: "핼러윈 파티", members: ["family"], done: false },
  { id: "evt-0002", date: "2026-10-31", start: "10:00", end: "11:00", allDay: false, title: "치과", members: ["haneul"], done: false },
  { id: "evt-0003", date: "2026-11-03", start: "15:00", allDay: false, title: "학부모 상담", members: ["mom"], done: false },
  { id: "evt-0004", date: "2026-12-31", allDay: true, title: "송년 모임", members: ["family"], done: false },
  { id: "evt-0005", date: "2027-01-02", start: "09:00", allDay: false, title: "새해 등산", members: ["mom"], done: false },
];
const tasks: Task[] = [
  { id: "task-0001", list: "shopping", title: "우유", done: false },
  { id: "task-0002", list: "shopping", title: "사과", member: "mom", done: false },
  { id: "task-0003", list: "shopping", title: "계란", done: true },
  { id: "task-0004", list: "todo", title: "도서관 책 반납", member: "haneul", done: false },
];
const anniversaries: Anniversary[] = [
  { monthDay: "11-08", title: "아빠 생일", member: "family" },
  { monthDay: "12-25", title: "크리스마스" },
];
const wiki = { members, events, tasks, anniversaries };
// 2026-10-29(목) 22:00 서울
const now = new Date("2026-10-29T13:00:00Z");

const fake = (out: unknown): LlmAdapter => ({ name: "fake", json: async () => out });
const ask = async (text: string, out: unknown = { intent: "question" }, at = now) =>
  (await answerQuestion({ text, now: at, senderSlackId: "U00MOM", ...wiki }, fake(out))).text ?? "";

describe("질문 응답: 수용 기준", () => {
  it("'이번 주 토요일 뭐 있어?' -> 그날 위키 일정으로 답한다", async () => {
    const a = await ask("이번 주 토요일 뭐 있어?");
    expect(a).toContain("10/31(토)");
    expect(a).toContain("종일 핼러윈 파티 (가족)");
    expect(a).toContain("10:00-11:00 치과 (하늘)");
    expect(a).not.toContain("학부모 상담");
  });

  it("실제 sample-wiki 픽스처로도 답한다", async () => {
    const root = fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url));
    const fam = asFamilyId("default");
    const w = await new FsWikiRepository({ root, readOnly: true, familyId: fam }).read(fam);
    const r = await answerQuestion({ text: "이번 주 토요일 뭐 있어?", now, ...w }, fake({ intent: "question" }));
    expect(r.text).toContain("핼러윈 파티");
  });

  it("해당 날짜가 비어 있으면 없다고 답하고 지어내지 않는다", async () => {
    const a = await ask("모레 뭐 있어?", { intent: "question", from: "2026-10-31", to: "2026-10-31" }, new Date("2026-11-03T03:00:00Z")); // 11/5
    expect(a).toBe("11/5(목) 일정은 위키에 없어요.");
  });

  it("LLM이 위키에 없는 일정·id·제목을 줘도 답에 나오지 않는다", async () => {
    const a = await ask("이번 주 일요일 뭐 있어?", {
      intent: "question",
      title: "가짜 소풍",
      targetIds: ["evt-9999"],
      items: [{ title: "유령 항목", list: "todo" }],
      keyword: "소풍",
      targets: ["events", "bogus"],
      from: "2026-11-01",
      to: "2026-11-01",
    });
    expect(a).not.toContain("소풍");
    expect(a).not.toContain("evt-");
    expect(a).not.toContain("유령");
    expect(a).toBe("11/1(일) 일정은 위키에 없어요.");
  });

  it("키워드는 사용자 원문에 없으면 버린다(지어낸 필터가 답을 비우지 않는다)", async () => {
    const a = await ask("이번 주 토요일 뭐 있어?", { intent: "question", keyword: "수영" });
    expect(a).toContain("핼러윈 파티");
  });

  it("코드가 계산한 날짜가 LLM이 준 날짜보다 우선한다", async () => {
    const a = await ask("이번 주 토요일 뭐 있어?", { intent: "question", from: "2026-11-03", to: "2026-11-03" });
    expect(a).toContain("핼러윈 파티");
    expect(a).not.toContain("학부모 상담");
  });

  it("코드가 날짜를 못 읽으면 검증된 LLM 날짜를 쓴다. 잘못된 날짜는 버리고 앞으로 7일", async () => {
    expect(await ask("그날 뭐 있었더라", { intent: "question", from: "2026-11-03", to: "2026-11-03" })).toContain("학부모 상담");
    const bad = await ask("뭐 있어?", { intent: "question", from: "2026-13-45", to: "abc" });
    expect(bad).toContain("10/29(목)~11/4(수)");
    expect(bad).toContain("학부모 상담");
    expect(bad).not.toContain("송년");
    const huge = await ask("뭐 있어?", { intent: "question", from: "2000-01-01", to: "2090-01-01" });
    expect(huge).toContain("10/29(목)~11/4(수)");
  });
});

describe("질문 응답: 실패", () => {
  it("LLM이 던지면 모르겠다고 답한다", async () => {
    const llm: LlmAdapter = { name: "boom", json: async () => { throw new Error("timeout"); } };
    const r = await answerQuestion({ text: "이번 주 토요일 뭐 있어?", now, ...wiki }, llm);
    expect(r.text).toBe(NO_ANSWER);
    expect(r.intent.type).toBe("unknown");
  });
  it("형식 오류·unknown도 모르겠다고 답한다", async () => {
    expect((await answerQuestion({ text: "?", now, ...wiki }, fake({ nonsense: 1 }))).text).toBe(NO_ANSWER);
    expect((await answerQuestion({ text: "ㅋㅋ", now, ...wiki }, fake({ intent: "unknown" }))).text).toBe(NO_ANSWER);
  });
  it("쓰기 의도는 답하지 않고 그대로 돌려준다", async () => {
    const r = await answerQuestion({ text: "내일 3시 치과", now, ...wiki }, fake({ intent: "event.add", date: "2026-10-30", start: "15:00", title: "치과", members: ["haneul"] }));
    expect(r.text).toBeUndefined();
    expect(r.intent.type).toBe("change");
  });
});

describe("질문 응답: 기간 표현과 경계", () => {
  it("일요일에 물어도 월요일 시작 기준: 이번 주 토요일 = 어제", async () => {
    const sunday = new Date("2026-11-01T03:00:00Z"); // 11/1(일) 12:00
    const a = await ask("이번 주 토요일 뭐 있어?", { intent: "question" }, sunday);
    expect(a).toContain("10/31(토)");
    expect(a).toContain("핼러윈 파티");
  });
  it("이번 주말(토~일)과 기념일", async () => {
    const a = await ask("이번 주말 뭐 있어?");
    expect(a).toContain("10/31(토)~11/1(일)");
    expect(a).toContain("10/31(토)\n- ");
  });
  it("다음 주: 월~일, 날짜별로 묶는다. 기념일도 범위 안이면 나온다", async () => {
    const a = await ask("다음 주 뭐 있어?");
    expect(a).toContain("11/2(월)~11/8(일) 일정 2건이에요.");
    expect(a).toContain("11/3(화)\n- 15:00 학부모 상담 (엄마)");
    expect(a).toContain("11/8(일)\n- 🎉 아빠 생일 (가족)");
  });
  it("월말: 이번 달", async () => {
    const a = await ask("이번 달 일정 알려줘");
    expect(a).toContain("10/1(목)~10/31(토)");
    expect(a).toContain("치과");
    expect(a).not.toContain("학부모");
  });
  it("연말 경계: 12/31에 '내일'은 1/1, '모레'는 1/2", async () => {
    const eve = new Date("2026-12-31T03:00:00Z");
    expect(await ask("모레 뭐 있어?", { intent: "question" }, eve)).toContain("새해 등산");
    expect(await ask("내일 뭐 있어?", { intent: "question" }, eve)).toBe("2027년 1/1(금) 일정은 위키에 없어요.");
    expect(await ask("오늘 일정", { intent: "question" }, eve)).toContain("송년 모임");
  });
  it("서버 기준 시각(서울): UTC로는 아직 전날이어도 서울 날짜로 계산", async () => {
    const lateUtc = new Date("2026-10-30T16:00:00Z"); // 서울 10/31 01:00
    expect(await ask("오늘 뭐 있어?", { intent: "question" }, lateUtc)).toContain("10/31(토)");
  });
  it("구성원·키워드 필터. 가족 전체 일정은 구성원 질문에도 포함", async () => {
    const a = await ask("하늘 이번 주 토요일 일정");
    expect(a).toContain("하늘");
    expect(a).toContain("치과");
    expect(a).toContain("핼러윈");
    expect(await ask("다음 주 엄마 일정")).not.toContain("아빠 생일 (가족)\n- 치과");
    const k = await ask("치과 언제야?", { intent: "question", keyword: "치과" });
    expect(k).toContain("10/31(토)");
    expect(k).not.toContain("핼러윈");
  });
});

describe("질문 응답: 할 일·기념일", () => {
  it("장보기: 남은 것만(완료 제외)", async () => {
    const a = await ask("장보기 뭐 남았어?");
    expect(a).toBe("남은 장보기 2개예요.\n- 우유\n- 사과 (엄마)");
  });
  it("할 일", async () => {
    expect(await ask("하늘 할 일 뭐야?")).toBe("남은 할 일 1개예요.\n- 도서관 책 반납 (하늘)");
  });
  it("비었으면 없다고", async () => {
    const r = await answerQuestion({ text: "장보기 뭐 남았어?", now, ...wiki, tasks: [] }, fake({ intent: "question" }));
    expect(r.text).toBe("남은 장보기가 위키에 없어요.");
  });
  it("기념일/생일 질문", async () => {
    const a = await ask("다음 달 생일 있어?");
    expect(a).toContain("11/8(일)");
    expect(a).toContain("아빠 생일");
    expect(a).not.toContain("크리스마스");
    expect(await ask("이번 달 기념일 뭐 있어?")).toBe("10/1(목)~10/31(토) 기념일은 위키에 없어요.");
  });
});

describe("질문 응답: 리뷰 되돌림 수정", () => {
  it("keyword가 요일·서술어여도 필터로 쓰지 않는다", async () => {
    for (const keyword of ["토요일", "있어", "이번 주 토요일", "뭐 있어"]) {
      const a = await ask("이번 주 토요일 뭐 있어?", { intent: "question", keyword });
      expect(a).toContain("핼러윈 파티");
      expect(a).toContain("치과");
      expect(a).not.toContain("위키에 없어요");
    }
  });
  it("원문에 있지만 위키 제목 어디에도 없는 keyword는 관계없는 목록 대신 없다고 답한다", async () => {
    expect(await ask("수영 언제야?", { intent: "question", keyword: "수영" })).toBe("'수영'은 위키에 없어요.");
    expect(await ask("치과 말고 학원 언제야?", { intent: "question", keyword: "학원" })).toBe("'학원'은 위키에 없어요.");
  });
  it("기간이 정해진 질문에서는 제목에 없는 keyword를 버리고 그 기간 목록으로 답한다", async () => {
    const cases: [string, string][] = [
      ["이번 주 토요일 계획 있어?", "계획"],
      ["이번 주 토요일 가족 행사 있어?", "행사"],
      ["이번 주 토요일 하늘이 뭐 해?", "하늘이"],
      ["이번 주 토요일 하는 날이야?", "하는 날이야"],
      ["이번 주 토요일 수영 뭐 있어?", "수영"],
    ];
    for (const [text, keyword] of cases) {
      const a = await ask(text, { intent: "question", keyword });
      expect(a, text).toContain("핼러윈 파티");
      expect(a, text).not.toContain("위키에 없어요");
    }
    // 검증된 LLM 기간만 있어도 마찬가지
    const b = await ask("그날 계획 뭐야", { intent: "question", keyword: "계획", from: "2026-10-31", to: "2026-10-31" });
    expect(b).toContain("핼러윈 파티");
  });
  it("'토요일에 핼러윈 말고 뭐 있어?' -> 말고 뒤에 날짜가 없으면 앞쪽 날짜(토요일)로 답한다", async () => {
    const a = await ask("토요일에 핼러윈 말고 뭐 있어?");
    expect(a).toContain("10/31(토)");
    expect(a).toContain("치과");
  });
  it("제목에 맞는 keyword는 그대로 필터", async () => {
    const a = await ask("치과 언제야?", { intent: "question", keyword: "치과" });
    expect(a).toContain("치과");
    expect(a).not.toContain("핼러윈");
  });
  it("'말고' 질문은 뒤쪽 기간으로 답한다", async () => {
    const a = await ask("이번 주 말고 다음 주 뭐 있어?");
    expect(a).toContain("11/2(월)~11/8(일)");
    expect(a).toContain("학부모 상담");
  });
  it("'하늘 생일 언제야?' -> 날짜 표현이 없으면 1년을 본다(기념일은 다음 돌아오는 날, 연도 표시)", async () => {
    const w = { ...wiki, anniversaries: [...anniversaries, { monthDay: "08-15", title: "하늘 생일", member: "haneul" }] };
    const r = await answerQuestion({ text: "하늘 생일 언제야?", now, ...w }, fake({ intent: "question", keyword: "생일" }));
    expect(r.text).toContain("2027년 8/15(일)");
    expect(r.text).toContain("하늘 생일 (하늘)");
    expect(r.text).not.toContain("크리스마스"); // 구성원이 없는 기념일은 하늘 질문에서 제외
  });
  it("원문에서 날짜를 계산했으면 LLM targets가 tasks/anniversaries뿐이어도 그날 일정이 나온다", async () => {
    for (const targets of [["tasks"], ["anniversaries"]]) {
      const a = await ask("이번 주 토요일 뭐 있어?", { intent: "question", targets });
      expect(a).toContain("핼러윈 파티");
    }
    // 종류 단서가 있으면 단서를 따른다
    expect(await ask("장보기 뭐 남았어?", { intent: "question", targets: ["events"] })).not.toContain("핼러윈");
  });
  it("조사: 받침에 따라 이/가", async () => {
    expect(await ask("하늘 할 일 뭐야?", { intent: "question" })).toContain("할 일 1개");
    const r = await answerQuestion({ text: "엄마 할 일 뭐야?", now, ...wiki, tasks: [] }, fake({ intent: "question" }));
    expect(r.text).toBe("엄마 남은 할 일이 위키에 없어요.");
  });
  it("연도가 다른 날짜는 연도를 붙인다", async () => {
    const a = await ask("2027년 1월 2일 뭐 있어?");
    expect(a).toContain("2027년 1/2(토)");
    expect(a).toContain("새해 등산");
  });
});

describe("프롬프트", () => {
  it("question 필드 지시를 넣는다", () => {
    const p = buildSystemPrompt({ today: "2026-10-29", now: "22:00", members, events, tasks });
    expect(p).toContain("답은 코드가 위키에서 만든다");
  });
});
