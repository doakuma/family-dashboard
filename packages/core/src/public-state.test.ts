import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FsWikiRepository } from "./node/fs-wiki";
import { eventsForMonthView, toPublicState } from "./public-state";
import { parseEventsFile } from "./wiki/format";
import { apiStateSchema } from "./schema";
import { DEFAULT_FAMILY_ID } from "./types";

const wiki = new FsWikiRepository({ root: resolve(import.meta.dirname, "../../../fixtures/sample-wiki"), readOnly: true });
const raw = await wiki.read(DEFAULT_FAMILY_ID);
// 민감 필드가 실제 값으로 채워진 상태에서 시험한다
const state = {
  ...raw,
  config: { ...raw.config!, calendarId: "family-secret@group.calendar.google.com" },
  weather: [],
  updatedAt: "2026-11-03T01:00:00Z",
};
const pub = toPublicState(state, "2026-11-03");
const json = JSON.stringify(pub);

describe("toPublicState", () => {
  it("응답 스키마를 통과한다", () => {
    expect(apiStateSchema.parse(JSON.parse(json))).toMatchObject({ needsSetup: false, familyName: state.config.familyName });
  });

  it("familyId는 공개 응답에 없다(내부 상태에는 있다)", () => {
    expect(state.familyId).toBe(DEFAULT_FAMILY_ID);
    expect(json).not.toContain("familyId");
    // 가족 id 값 자체도 없어야 한다(스킨 id "default"와 값이 같을 수 있어 skin 필드는 빼고 본다)
    expect(JSON.stringify({ ...pub, skin: undefined })).not.toContain(`"${DEFAULT_FAMILY_ID}"`);
  });

  it("skin은 공개하고(태블릿 전환용) character는 none 고정, config 원문은 없다", () => {
    expect(pub.skin).toBe("default");
    expect(pub.character).toBe("none");
    expect(toPublicState({ ...state, skin: "paper", character: "none" }, "2026-11-03").skin).toBe("paper");
  });

  it("주소·slackId·calendarId·역할·생일 원문이 JSON 어디에도 없다", () => {
    expect(state.config.region).toBeTruthy();
    expect(raw.members.some((m) => m.slackId)).toBe(true);
    expect(raw.members.some((m) => m.birth)).toBe(true);
    expect(json).not.toContain(state.config.region!);
    expect(json).not.toContain("calendarId");
    expect(json).not.toContain("group.calendar.google.com");
    for (const m of raw.members) {
      if (m.slackId) expect(json).not.toContain(m.slackId);
      if (m.birth) expect(json).not.toContain(m.birth);
    }
    for (const key of ["region", "slackId", "birth", "role", "kmaNx", "kmaMidLandRegId", "timezone", "setupCompletedAt", "config"]) {
      expect(json).not.toContain(`"${key}"`);
    }
  });

  it("일정 share는 그룹 id만 내보낸다(상세 시트용, 결정 0006). 없으면 필드도 없다", () => {
    const shared = state.events.find((e) => e.share === "cousins");
    expect(shared).toBeTruthy();
    expect(pub.events.find((e) => e.id === shared!.id)?.share).toBe("cousins");
    expect(pub.events.filter((e) => e.share).length).toBe(state.events.filter((e) => e.share).length);
    expect(pub.events.find((e) => !e.share && "share" in e)).toBeUndefined();
  });

  it("깨진 원문 토큰(&A &B, &!)은 내보내지 않는다", () => {
    const parsed = parseEventsFile("- [ ] 2026-11-03 15:00 모임 @haneul &a &b #evt-x1\n- [ ] 2026-11-04 15:00 모임2 @haneul &bad! #evt-x2\n", () => {});
    expect(parsed).toHaveLength(2);
    const out = JSON.stringify(toPublicState({ ...state, events: parsed }, "2026-11-03").events);
    expect(out).not.toContain("&");
    expect(out).not.toContain("bad!");
    expect(out).not.toContain('"share"');
  });

  it("구성원은 id·name·color만", () => {
    for (const m of pub.members) expect(Object.keys(m).sort()).toEqual(["color", "id", "name"]);
  });

  it("생일 기념일에는 다음 생일 날짜와 나이를 미리 계산해 준다", () => {
    const mom = raw.members.find((m) => m.birth)!;
    const a = { monthDay: mom.birth!.slice(5), title: `${mom.name} 생일`, member: mom.id };
    const p = toPublicState({ ...state, anniversaries: [a, { monthDay: "12-25", title: "크리스마스" }] }, "2026-11-03");
    const y = Number(mom.birth!.slice(0, 4));
    const next = p.anniversaries[0]!.turns!;
    expect(next.age).toBe(Number(next.date.slice(0, 4)) - y);
    expect(next.date >= "2026-11-03").toBe(true);
    expect(p.anniversaries[1]!.turns).toBeUndefined();
  });

  it("생일 당일은 올해 날짜, 지난 다음 날은 내년 날짜", () => {
    const m = { id: "k", name: "케이", color: "teal", role: "guardian" as const, birth: "2000-03-12" };
    const s = { ...state, members: [m], anniversaries: [{ monthDay: "03-12", title: "케이 생일", member: "k" }] };
    expect(toPublicState(s, "2026-03-12").anniversaries[0]!.turns).toEqual({ date: "2026-03-12", age: 26 });
    expect(toPublicState(s, "2026-03-13").anniversaries[0]!.turns).toEqual({ date: "2027-03-12", age: 27 });
  });

  it("세팅 필요 판정을 포함한다", () => {
    expect(toPublicState({ ...state, config: undefined, members: [] }, "2026-11-03").needsSetup).toBe(true);
  });
});

describe("eventsForMonthView", () => {
  const ev = (id: string, date: string) => ({ id, date, allDay: true, title: id, members: ["family"], done: false });
  const list = [ev("a", "2026-10-31"), ev("b", "2026-11-03"), ev("c", "2026-12-05"), ev("d", "2026-12-06"), ev("e", "2027-01-01"), ev("f", "2026-10-25")];

  it("그 달 달력 칸(이웃 달 날짜 포함)의 일정을 싣는다", () => {
    // 2026-11 달력: 11/1(일) ~ 12/5(토)
    expect(eventsForMonthView(list, "2026-11", "2026-11-03").map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("보고 있는 달과 상관없이 오늘·내일 일정은 항상 포함한다", () => {
    expect(eventsForMonthView(list, "2027-01", "2026-10-31").map((e) => e.id)).toEqual(["a", "e"]);
    expect(eventsForMonthView(list, "2030-01", "2026-12-05").map((e) => e.id)).toEqual(["c", "d"]);
  });

  it("일정 파일이 없는 달은 빈 달", () => {
    expect(eventsForMonthView(list, "2030-01", "2026-11-20")).toEqual([]);
  });
});
