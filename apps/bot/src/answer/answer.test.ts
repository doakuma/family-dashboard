import {
  asFamilyId,
  type Anniversary,
  type Change,
  type Event,
  type FamilyId,
  type LlmAdapter,
  type LlmRequest,
  type Member,
  type Task,
  type WikiRepository,
  type WikiState,
} from "@hsh/core";
import { FamilyMismatchError, FsWikiRepository } from "@hsh/core/node";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { answerFromQuery, answerQuestion } from "./answer";

const members: Member[] = [
  { id: "mom", name: "엄마", role: "guardian", color: "coral", slackId: "U00MOM" },
  { id: "haneul", name: "하늘", role: "child", color: "blue" },
  { id: "family", name: "가족", role: "guardian", color: "gray" },
];
const ev = (id: string, date: string, title: string, o: Partial<Event> = {}): Event => ({
  id,
  date,
  allDay: true,
  title,
  members: ["family"],
  done: false,
  ...o,
});
const events: Event[] = [
  ev("evt-1", "2026-10-31", "핼러윈 파티"),
  ev("evt-2", "2026-10-31", "미술학원", { allDay: false, start: "14:00", end: "15:00", members: ["haneul"] }),
  ev("evt-3", "2026-10-30", "회의", { allDay: false, start: "09:00", members: ["mom"] }),
  ev("evt-4", "2026-11-03", "치과", { allDay: false, start: "15:00", members: ["haneul"], share: "cousins" }),
  ev("evt-5", "2026-11-05", "치과", { allDay: false, start: "15:00", members: ["mom"] }),
];
const tasks: Task[] = [
  { id: "task-1", list: "shopping", title: "우유", done: false },
  { id: "task-2", list: "shopping", title: "기저귀", member: "mom", done: false },
  { id: "task-3", list: "shopping", title: "계란", done: true },
  { id: "task-4", list: "todo", title: "도서관 책 반납", member: "haneul", done: false },
];
const anniversaries: Anniversary[] = [
  { monthDay: "10-31", title: "하늘 할로윈 기념", member: "haneul" },
  { monthDay: "11-08", title: "아빠 생일", member: "family" },
  { monthDay: "03-12", title: "엄마 생일", member: "mom" },
];
// 2026-10-30(금) 12:00 서울
const now = new Date("2026-10-30T03:00:00Z");
const FAMILY = asFamilyId("default");

function state(over: Partial<WikiState> = {}): WikiState {
  return { familyId: FAMILY, skin: "default", character: "none", members, events, tasks, anniversaries, warnings: [], ...over };
}

/** 쓰기가 호출되면 기록하는 가짜 위키. 질문 경로는 apply를 절대 부르면 안 된다. */
function fakeRepo(s: WikiState = state()) {
  const calls: string[] = [];
  const repo: WikiRepository = {
    async read(id: FamilyId) {
      calls.push("read");
      if (id !== s.familyId) throw new Error(`다른 가족: ${id}`);
      return s;
    },
    async apply(_id: FamilyId, _c: Change) {
      calls.push("apply");
      throw new Error("질문 경로에서 쓰면 안 돼요");
    },
    async applySetup() {
      calls.push("applySetup");
      throw new Error("질문 경로에서 쓰면 안 돼요");
    },
  };
  return { repo, calls };
}

function fakeLlm(out: unknown | (() => unknown)): LlmAdapter & { last?: LlmRequest } {
  const c: LlmAdapter & { last?: LlmRequest } = {
    name: "fake",
    async json(req) {
      c.last = req;
      return typeof out === "function" ? (out as () => unknown)() : out;
    },
  };
  return c;
}
const ask = async (text: string, llmOut: unknown, s = state()) => {
  const { repo, calls } = fakeRepo(s);
  const llm = fakeLlm(llmOut);
  const r = await answerQuestion({ text, now, familyId: FAMILY, senderSlackId: "U00MOM" }, { wiki: repo, llm });
  return { r, calls, llm };
};

describe("answerQuestion: 이번 주 토요일 뭐 있어?", () => {
  it("10/31 항목만, 위키에 있는 그대로 답한다", async () => {
    const { r, calls } = await ask("이번 주 토요일 뭐 있어?", { intent: "question" });
    expect(r.status).toBe("answered");
    if (r.status !== "answered") return;
    expect(r.text).toBe(
      ["10/31(토) 일정 3건이에요.", "• 10/31(토) 종일 핼러윈 파티 (가족)", "• 10/31(토) 종일 🎉 하늘 할로윈 기념 (매년)", "• 10/31(토) 14:00~15:00 미술학원 (하늘)"].join("\n"),
    );
    expect(r.range).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(r.eventIds).toEqual(["evt-1", "evt-2"]);
    expect(calls).toEqual(["read"]);
  });

  it("공유 일정은 그룹을 밝힌다", async () => {
    const { r } = await ask("다음 주 화요일 일정", { intent: "question" });
    expect(r.status === "answered" && r.text).toBe(["11/3(화) 일정 1건이에요.", "• 11/3(화) 15:00 치과 (하늘) · 공유: cousins"].join("\n"));
  });

  it("범위 안의 여러 날은 날짜순", async () => {
    const { r } = await ask("이번 주 뭐 있어?", { intent: "question" });
    expect(r.status === "answered" && r.eventIds).toEqual(["evt-3", "evt-1", "evt-2"]);
  });
});

describe("지어내지 않기", () => {
  it("위키에 없는 날짜는 없다고 답한다", async () => {
    const { r } = await ask("11월 1일 뭐 있어?", { intent: "question" });
    expect(r).toMatchObject({ status: "empty", text: "11/1(일)에는 위키에 등록된 일정이 없어요." });
  });

  it("LLM이 엉뚱한 제목·날짜를 내놔도 답에 나타나지 않는다", async () => {
    const { r } = await ask("11월 1일 뭐 있어?", {
      intent: "question",
      title: "가짜 파티",
      date: "2026-11-01",
      qFrom: "2026-11-01",
      qTo: "2026-11-01",
      qKeyword: "가짜 파티",
      qKinds: ["events"],
      items: [{ title: "지어낸 일정", list: "todo" }],
      answer: "11/1에 가짜 파티가 있어요",
    });
    expect(r.text).toBe("11/1(일)에는 위키에 등록된 일정이 없어요.");
    expect(r.text).not.toContain("가짜");
    expect(r.text).not.toContain("지어낸");
  });

  it("코드가 날짜를 해석하면 LLM의 다른 날짜보다 우선한다", async () => {
    const { r } = await ask("이번 주 토요일 뭐 있어?", { intent: "question", qFrom: "2026-11-03", qTo: "2026-11-03" });
    expect(r.status === "answered" && r.range).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(r.text).not.toContain("치과");
  });

  it("코드가 날짜를 못 읽으면 LLM 범위를 검증해서 쓴다", async () => {
    const { r } = await ask("그날 뭐 있었지", { intent: "question", qFrom: "2026-11-03", qTo: "2026-11-03" });
    expect(r.status === "answered" && r.eventIds).toEqual(["evt-4"]);
  });

  it("LLM 범위가 거꾸로이거나 너무 길면 되묻는다", async () => {
    expect((await ask("그날 뭐 있었지", { intent: "question", qFrom: "2026-11-05", qTo: "2026-11-03" })).r.status).toBe("clarify");
    expect((await ask("그날 뭐 있었지", { intent: "question", qFrom: "2026-01-01", qTo: "2026-12-31" })).r.status).toBe("clarify");
  });

  it("글에 없는 키워드(LLM 환각)로 걸러 없다고 말하지 않는다", async () => {
    const { r } = await ask("이번 주 토요일 뭐 있어?", { intent: "question", qKeyword: "병원" });
    expect(r.status).toBe("answered");
  });

  it("메시지가 질문이 아니면 답하지 않고 의도를 돌려준다", async () => {
    const { r } = await ask("내일 3시 치과", { intent: "event.add", date: "2026-10-31", start: "15:00", title: "치과", members: ["haneul"] });
    expect(r.status).toBe("not_question");
  });
});

describe("되묻기와 쓰기 없음", () => {
  it("LLM 예외 -> 되묻기, 쓰기 없음", async () => {
    const { r, calls } = await ask("이번 주 토요일 뭐 있어?", () => {
      throw new Error("연결 거부");
    });
    expect(r.status).toBe("clarify");
    expect(r.text).toContain("다시");
    expect(r.text).not.toContain("연결 거부");
    expect(calls).toEqual(["read"]);
  });

  it("잘못된 JSON -> 되묻기, 쓰기 없음", async () => {
    for (const bad of ["not json", null, { intent: "dance" }, { intent: "question", qKinds: ["weather"] }]) {
      const { r, calls } = await ask("이번 주 토요일 뭐 있어?", bad);
      expect(r.status).toBe("clarify");
      expect(calls).toEqual(["read"]);
    }
  });

  it("날짜를 알 수 없는 질문 -> 되묻기", async () => {
    const { r } = await ask("뭐 있어?", { intent: "question" });
    expect(r.status).toBe("clarify");
    expect(r.text).toContain("언제");
  });

  it("너무 긴 기간 -> 되묻기", async () => {
    const { r } = await ask("오늘이랑 1월 5일 일정", { intent: "question" });
    expect(r.status).toBe("clarify");
    expect(r.text).toContain("너무 길어요");
  });
});

describe("구성원·키워드·종류", () => {
  it("구성원 이름이 있으면 그 사람과 가족 전체 일정만", async () => {
    const { r } = await ask("이번 주 토요일 하늘 일정", { intent: "question" });
    expect(r.status === "answered" && r.text).toContain("하늘 일정");
    expect(r.status === "answered" && r.eventIds).toEqual(["evt-1", "evt-2"]);
    const m = await ask("이번 주 엄마 일정", { intent: "question" });
    expect(m.r.status === "answered" && m.r.eventIds).toEqual(["evt-3", "evt-1"]);
  });

  it("LLM이 준 구성원 id는 검증해서 쓴다", async () => {
    const { r } = await ask("이번 주 뭐 있어?", { intent: "question", qMembers: ["mom", "ghost"] });
    expect(r.status === "answered" && r.eventIds).toEqual(["evt-3", "evt-1"]);
  });

  it("키워드가 질문에 있으면 제목으로 거른다. 날짜가 없으면 가까운 순", async () => {
    const { r } = await ask("치과 언제야?", { intent: "question", qKeyword: "치과" });
    expect(r.status === "answered" && r.eventIds).toEqual(["evt-4", "evt-5"]);
    expect(r.text.startsWith("가까운 '치과' 일정 2건이에요.")).toBe(true);
  });

  it("키워드가 맞는 게 없으면 없다고 답한다", async () => {
    const { r } = await ask("피아노 언제야?", { intent: "question", qKeyword: "피아노" });
    expect(r.status).toBe("empty");
    expect(r.text).toContain("없어요");
  });

  it("기념일·생일: 다음 발생일을 구해 포함한다", async () => {
    const { r } = await ask("11월 일정", { intent: "question" });
    expect(r.status === "answered" && r.text).toContain("• 11/8(일) 종일 🎉 아빠 생일 (매년)");
    const b = await ask("엄마 생일 언제야?", { intent: "question" });
    expect(b.r).toMatchObject({ status: "answered", anniversaries: ["엄마 생일"] });
    expect(b.r.text).toContain("3/12(금)");
  });

  it("할 일·장보기: 남은 것만 (완료는 제외), 구성원 필터", async () => {
    const a = await ask("장보기 뭐 남았어?", { intent: "question" });
    expect(a.r.status === "answered" && a.r.taskIds).toEqual(["task-1", "task-2"]);
    expect(a.r.text).toBe(["남은 장보기 2개예요.", "• 우유", "• 기저귀 (엄마)"].join("\n"));
    const b = await ask("하늘 할 일", { intent: "question" });
    expect(b.r.status === "answered" && b.r.taskIds).toEqual(["task-4"]);
    const c = await ask("할 일 뭐 있어", { intent: "question", qKinds: ["tasks"] }, state({ tasks: [] }));
    expect(c.r).toMatchObject({ status: "empty", text: "남은 할 일이 없어요." });
  });

  it("길면 줄여서 보낸다", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`evt-${i}`, "2026-11-10", `일정${i}`));
    const { r } = await ask("11월 10일", { intent: "question" }, state({ events: many }));
    expect(r.text.split("\n").length).toBe(22);
    expect(r.text).toContain("외 10건");
  });
});

describe("answerFromQuery (LLM 없이 순수)", () => {
  it("같은 입력은 같은 답", () => {
    const ctx = { today: "2026-10-30", members, events, tasks, anniversaries };
    const q = { text: "내일 뭐 있어?" };
    expect(answerFromQuery(q, ctx)).toEqual(answerFromQuery(q, ctx));
  });
});

describe("familyId 경계", () => {
  it("다른 가족 id로 읽으면 위키 저장소의 거부가 그대로 올라온다(되묻기로 숨기지 않는다)", async () => {
    const { repo } = fakeRepo();
    await expect(
      answerQuestion({ text: "내일 뭐 있어?", now, familyId: asFamilyId("other") }, { wiki: repo, llm: fakeLlm({ intent: "question" }) }),
    ).rejects.toThrow("다른 가족");
  });

  it("FsWikiRepository(sample-wiki)도 다른 가족이면 FamilyMismatchError", async () => {
    const root = fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url));
    const repo = new FsWikiRepository({ root, readOnly: true, familyId: FAMILY });
    await expect(
      answerQuestion({ text: "내일 뭐 있어?", now, familyId: asFamilyId("other") }, { wiki: repo, llm: fakeLlm({ intent: "question" }) }),
    ).rejects.toBeInstanceOf(FamilyMismatchError);
  });

  it("sample-wiki 실제 파일로 이번 주 토요일에 답한다", async () => {
    const root = fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url));
    const repo = new FsWikiRepository({ root, readOnly: true, familyId: FAMILY });
    const r = await answerQuestion({ text: "이번 주 토요일 뭐 있어?", now, familyId: FAMILY }, { wiki: repo, llm: fakeLlm({ intent: "question" }) });
    expect(r.status === "answered" && r.text).toContain("10/31(토) 종일 핼러윈 파티 (가족)");
  });

  it("답은 familyId·git 용어를 내보내지 않는다", async () => {
    const { r } = await ask("이번 주 토요일 뭐 있어?", { intent: "question" });
    expect(JSON.stringify(r)).not.toMatch(/familyId|default|commit|sha|branch/i);
  });
});

/** 질문으로 답하는 경우만 쓰는 도우미(not_question이면 실패) */
const askA = async (text: string, llmOut: unknown, s = state()) => {
  const x = await ask(text, llmOut, s);
  if (x.r.status === "not_question") throw new Error("질문이 아니라고 나왔어요");
  return { ...x, r: x.r };
};

describe("종류는 글의 단서가 정한다 (LLM qKinds는 좁히지 못한다)", () => {
  const onlyAnniv = state({ events: [], anniversaries: [{ monthDay: "10-31", title: "결혼기념일", member: "family" }] });

  it("날짜가 있으면 qKinds:[events]여도 그날 기념일이 나온다", async () => {
    const { r } = await askA("이번 주 토요일 뭐 있어?", { intent: "question", qKinds: ["events"] }, onlyAnniv);
    expect(r).toMatchObject({ status: "answered", anniversaries: ["결혼기념일"] });
    expect(r.text).toContain("결혼기념일");
  });

  it("날짜가 있으면 qKinds:[tasks]여도 그날 항목으로 답한다(할 일을 끼우지 않는다)", async () => {
    const { r } = await askA("이번 주 토요일 뭐 있어?", { intent: "question", qKinds: ["tasks"] });
    expect(r.eventIds).toEqual(["evt-1", "evt-2"]);
    expect(r.taskIds).toEqual([]);
    expect(r.text).not.toContain("우유");
  });

  it("날짜가 없으면 qKinds:[events]여도 되묻는다", async () => {
    const { r } = await askA("뭐 있어?", { intent: "question", qKinds: ["events"] });
    expect(r.status).toBe("clarify");
  });

  it("날짜가 없고 글에 단서가 없을 때 LLM의 tasks는 남은 할 일을 더해 보여 준다", async () => {
    const { r } = await askA("뭐 남았지?", { intent: "question", qKinds: ["tasks"] });
    expect(r.status).toBe("answered");
    expect(r.taskIds).toContain("task-1");
  });
});

describe("단어 안에서 단서가 걸리지 않는다", () => {
  it('"내일 회사야?"는 장보기가 아니라 내일 일정', async () => {
    const { r } = await askA("내일 회사야?", { intent: "question" });
    expect(r.taskIds).toEqual([]);
    expect(r.range).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(r.text).not.toContain("장보기");
  });
  it('"내일 할 일정"은 할 일이 아니라 일정', async () => {
    const { r } = await askA("내일 할 일정 있어?", { intent: "question" });
    expect(r.taskIds).toEqual([]);
    expect(r.eventIds).toEqual(["evt-1", "evt-2"]);
  });
  it('"내일 할 일"은 달력 항목도 빼지 않고 남은 할 일을 더한다', async () => {
    const { r } = await askA("내일 할 일 뭐 있어?", { intent: "question" });
    expect(r.eventIds).toEqual(["evt-1", "evt-2"]);
    expect(r.taskIds).toEqual(["task-4"]);
  });
  it('"하늘색"은 구성원 하늘이 아니고 "하늘이랑"은 구성원', async () => {
    const a = await askA("이번 주 토요일 하늘색 옷 입을 일정 있어?", { intent: "question" });
    expect(a.r.text).not.toContain("하늘 일정");
    expect(a.r.eventIds).toEqual(["evt-1", "evt-2"]);
    const b = await askA("이번 주 토요일 하늘이랑 일정", { intent: "question" });
    expect(b.r.text).toContain("하늘 일정");
  });
});

describe("목록 길이", () => {
  it("가까운 목록은 전체 건수를 밝히고 나머지는 외 N건", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ev(`evt-${i}`, `2026-11-${String(10 + i).padStart(2, "0")}`, "치과"));
    const { r } = await askA("치과 언제야?", { intent: "question", qKeyword: "치과" }, state({ events: many, anniversaries: [] }));
    expect(r.text.split("\n")[0]).toBe("가까운 '치과' 일정 8건이에요.");
    expect(r.text).toContain("…외 3건");
    expect(r.eventIds).toHaveLength(5);
  });
});

describe("떨어진 날짜", () => {
  it('"오늘이랑 모레"는 하나로 못 정해 되묻는다', async () => {
    const { r } = await askA("오늘이랑 모레 뭐 있어?", { intent: "question" });
    expect(r.status).toBe("clarify");
    expect(r.text).toContain("하나씩");
  });
});

// 스펙 rev 62 '날짜 해석': 주는 일요일 시작. 기준은 위의 now = 2026-10-30(금).
describe("rev 62: 일요일 시작 주", () => {
  it("이번 주 = 일~토(10/25~10/31), 다음 주 = 11/1~11/7", async () => {
    const a = await askA("이번 주 뭐 있어?", { intent: "question" });
    expect(a.r.range).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    const b = await askA("다음 주 뭐 있어?", { intent: "question" });
    expect(b.r.range).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(b.r.eventIds).toEqual(["evt-4", "evt-5"]);
  });
  it("일요일(11/1) 당일에 '이번 주 토요일'은 앞으로 올 토요일(11/7), '이번 주 일요일'은 오늘", async () => {
    const sunday = new Date("2026-11-01T03:00:00Z");
    const run = async (text: string) => (await answerQuestion({ text, now: sunday, familyId: FAMILY }, { wiki: fakeRepo().repo, llm: fakeLlm({ intent: "question" }) })) as { range?: unknown };
    expect((await run("이번 주 토요일 뭐 있어?")).range).toEqual({ from: "2026-11-07", to: "2026-11-07" });
    expect((await run("이번 주 일요일 뭐 있어?")).range).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });
  it("토요일(10/31) 당일에 '이번 주 일요일'은 내일(11/1)", async () => {
    const saturday = new Date("2026-10-31T03:00:00Z");
    const r = (await answerQuestion({ text: "이번 주 일요일 뭐 있어?", now: saturday, familyId: FAMILY }, { wiki: fakeRepo().repo, llm: fakeLlm({ intent: "question" }) })) as { range?: unknown };
    expect(r.range).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });
  it("과거형 질문은 연도 없는 날짜를 지난 날로 읽는다", async () => {
    const past = await askA("10월 24일 뭐 했어?", { intent: "question" });
    expect(past.r.range).toEqual({ from: "2026-10-24", to: "2026-10-24" });
    const future = await askA("10월 24일 일정", { intent: "question" });
    expect(future.r.range).toEqual({ from: "2027-10-24", to: "2027-10-24" });
  });
});

// 브랜치 hsh-10-question-alt의 회귀 케이스를 main 구조로 옮긴 것
describe("회귀: 날짜가 분명하면 LLM keyword가 그날 일정을 지우지 않는다", () => {
  it.each([
    ["이번 주 토요일 계획?", "계획"],
    ["이번 주 토요일 가족 행사?", "행사"],
    ["이번 주 토요일 하늘이 뭐 해?", "하늘이"],
  ])("%s", async (text, qKeyword) => {
    const { r } = await askA(text, { intent: "question", qKeyword });
    expect(r.status).toBe("answered");
    expect(r.text).toContain("핼러윈 파티");
    expect(r.text).not.toContain("없어요");
  });
  it("위키 제목에 있는 keyword는 날짜가 있어도 필터로 쓴다", async () => {
    const { r } = await askA("이번 주 토요일 미술학원 있어?", { intent: "question", qKeyword: "미술학원" });
    expect(r.eventIds).toEqual(["evt-2"]);
    const none = await askA("다음 주 미술학원 있어?", { intent: "question", qKeyword: "미술학원" });
    expect(none.r.status).toBe("empty");
  });
});

describe("회귀: 말고", () => {
  it("'이번 주 말고 다음 주 뭐 있어?' -> 뒤쪽(다음 주)만", async () => {
    const { r } = await askA("이번 주 말고 다음 주 뭐 있어?", { intent: "question" });
    expect(r.range).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(r.eventIds).toEqual(["evt-4", "evt-5"]);
  });
  it("'토요일에 핼러윈 말고 뭐 있어?' -> 뒤에 날짜가 없으면 앞쪽(토요일)", async () => {
    const { r } = await askA("토요일에 핼러윈 말고 뭐 있어?", { intent: "question" });
    expect(r.range).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(r.text).toContain("미술학원");
  });
});

describe("회귀: 생일·없는 일정", () => {
  const w = state({ anniversaries: [...anniversaries, { monthDay: "08-15", title: "하늘 생일", member: "haneul" }] });
  it("'하늘 생일 언제야?' -> 다음 돌아오는 하늘 생일(구성원 없는 기념일은 제외)", async () => {
    for (const out of [{ intent: "question", qKeyword: "생일" }, { intent: "question" }, { intent: "question", qKeyword: "하늘 생일" }]) {
      const { r } = await askA("하늘 생일 언제야?", out, w);
      expect(r.status).toBe("answered");
      expect(r.text).toContain("8/15(일)"); // main은 연도를 표기하지 않는다(alt와 다른 점)
      expect(r.text).toContain("하늘 생일");
      expect(r.text).not.toContain("엄마 생일");
      expect(r.text).not.toContain("아빠 생일"); // 가족(family) 구성원 기념일도 하늘 질문에선 제외
    }
  });
  it("'수영 언제야?' -> 위키에 없다고 답하고 관계없는 목록을 내지 않는다", async () => {
    const { r } = await askA("수영 언제야?", { intent: "question", qKeyword: "수영" });
    expect(r.status).toBe("empty");
    expect(r.text).toContain("수영");
    expect(r.text).toContain("없어요");
    expect(r.text).not.toContain("치과");
  });
});
