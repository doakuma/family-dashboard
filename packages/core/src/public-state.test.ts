import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FsWikiRepository } from "./node/fs-wiki";
import { toPublicState } from "./public-state";
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

  it("일정 share(&그룹)는 MVP 화면이 안 쓰므로 내보내지 않는다 (#31 상세 시트에서 필요해지면 추가)", () => {
    expect(state.events.some((e) => e.share === "cousins")).toBe(true); // 픽스처에 share 일정이 있다
    expect(json).not.toContain("cousins");
    expect(pub.events.every((e) => !("share" in e))).toBe(true);
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
