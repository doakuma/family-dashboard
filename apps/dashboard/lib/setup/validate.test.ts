import { setupSchema } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { extraAnniversaries, extraAnniversaryRows, serverIssuesToErrors, toPreviewState, toSetupInput, birthdayAnniversaries } from "./build";
import { addAnniversary, addMember, initialDraft, updateAnniversary, updateMember, type Draft } from "./draft";
import { firstErrorStep, stepOfField, validMonthDay, validateAnniversaries, validateCalendar, validateHome, validateMembers, validateStep } from "./validate";

const NOW = new Date("2026-10-30T03:00:00Z");

/** 모든 단계를 통과하는 기본 draft */
function good(): Draft {
  let d = initialDraft();
  d = { ...d, familyName: "햇살네", regionKey: "seoul-mapo" };
  d = updateMember(d, "m1", { name: "엄마", birth: "1988-03-12" });
  d = addMember(d);
  d = updateMember(d, "m2", { name: "하늘", birth: "2020-08-15" });
  d = addAnniversary(d, { title: "결혼기념일", month: "11", day: "21", member: "family" });
  return d;
}

describe("1단계: 우리 집", () => {
  it("정상", () => {
    expect(validateHome(good())).toEqual({});
  });
  it("가족 이름: 비었음·공백뿐·41자·줄바꿈·따옴표 감쌈", () => {
    const e = (familyName: string) => validateHome({ ...good(), familyName }).familyName;
    expect(e("")).toMatch(/입력해 주세요/);
    expect(e("   ")).toMatch(/입력해 주세요/);
    expect(e("가".repeat(41))).toMatch(/40자/);
    expect(e("가".repeat(40))).toBeUndefined();
    expect(e("햇살\n네")).toMatch(/제어 문자/);
    expect(e('"햇살네"')).toMatch(/따옴표/);
  });
  it("지역을 안 골랐거나 없는 지역이면 오류", () => {
    expect(validateHome({ ...good(), regionKey: "" }).region).toMatch(/골라/);
    expect(validateHome({ ...good(), regionKey: "nowhere" }).region).toMatch(/골라/);
  });
  it("직접 입력: 범위·형식 오류가 필드별로", () => {
    const base = { ...good(), regionMode: "manual" as const, manual: { label: "우리 동네", nx: "59", ny: "127", landId: "11B00000", taId: "11B10101" } };
    expect(validateHome(base)).toEqual({});
    expect(validateHome({ ...base, manual: { ...base.manual, nx: "0" } })["manual.nx"]).toMatch(/1~149/);
    expect(validateHome({ ...base, manual: { ...base.manual, nx: "abc" } })["manual.nx"]).toBeDefined();
    expect(validateHome({ ...base, manual: { ...base.manual, nx: "59.5" } })["manual.nx"]).toBeDefined();
    expect(validateHome({ ...base, manual: { ...base.manual, ny: "254" } })["manual.ny"]).toMatch(/1~253/);
    expect(validateHome({ ...base, manual: { ...base.manual, landId: "seoul" } })["manual.landId"]).toBeDefined();
    expect(validateHome({ ...base, manual: { ...base.manual, taId: "" } })["manual.taId"]).toBeDefined();
    expect(validateHome({ ...base, manual: { ...base.manual, label: "" } })["manual.label"]).toBeDefined();
  });
  it("시간대 기본 Asia/Seoul, 모르는 시간대는 오류", () => {
    expect(initialDraft().timezone).toBe("Asia/Seoul");
    expect(validateHome({ ...good(), timezone: "Mars/Base" }).timezone).toBeDefined();
    expect(validateHome({ ...good(), timezone: "Asia/Tokyo" }).timezone).toBeUndefined();
  });
});

describe("2단계: 구성원", () => {
  it("정상", () => {
    expect(validateMembers(good(), NOW)).toEqual({});
  });
  it("이름 필수, #·@·&토큰 금지", () => {
    expect(validateMembers(updateMember(good(), "m1", { name: "" }), NOW)["member.m1.name"]).toMatch(/입력/);
    expect(validateMembers(updateMember(good(), "m1", { name: "엄마@집" }), NOW)["member.m1.name"]).toMatch(/@/);
    expect(validateMembers(updateMember(good(), "m1", { name: "엄마 &cousins" }), NOW)["member.m1.name"]).toMatch(/&/);
  });
  it("생일: 형식·미래·너무 옛날", () => {
    const e = (birth: string) => validateMembers(updateMember(good(), "m1", { birth }), NOW)["member.m1.birth"];
    expect(e("2026-02-30")).toMatch(/형식/);
    expect(e("2027-01-01")).toMatch(/이후/);
    expect(e("1899-12-31")).toMatch(/1900/);
    expect(e("2026-10-30")).toBeUndefined(); // 오늘은 가능
    expect(e("")).toBeUndefined(); // 선택
  });
  it("id: 형식·예약어·중복(대소문자 무시)", () => {
    const e = (id: string) => validateMembers(updateMember(good(), "m2", { id }), NOW)["member.m2.id"];
    expect(e("하늘")).toMatch(/영문/);
    expect(e("a b")).toMatch(/영문/);
    expect(e("family")).toMatch(/family/);
    expect(e("FAMILY")).toMatch(/family/);
    expect(e("x".repeat(33))).toMatch(/32자/);
    for (const r of ["con", "NUL", "Com1", "lpt9"]) expect(e(r)).toMatch(/예약/);
    expect(e("com10")).toBeUndefined();
    expect(e("mom")).toBeUndefined();
    expect(validateMembers(updateMember(good(), "m2", { id: "MEMBER-1" }), NOW)["member.m2.id"]).toMatch(/같은 id/);
  });
  it("보호자가 한 명도 없으면 members 오류", () => {
    const d = updateMember(updateMember(good(), "m1", { role: "child" }), "m2", { role: "child" });
    expect(validateMembers(d, NOW).members).toMatch(/보호자/);
  });
  it("색이 팔레트 밖이면 오류", () => {
    expect(validateMembers(updateMember(good(), "m1", { color: "gray" }), NOW)["member.m1.color"]).toBeDefined();
  });
});

describe("4단계: 기념일", () => {
  it("월·일 검증 (2월 29일 허용, 4월 31일 거부)", () => {
    expect(validMonthDay("2", "29")).toBe(true);
    expect(validMonthDay("4", "31")).toBe(false);
    expect(validMonthDay("13", "1")).toBe(false);
    expect(validMonthDay("", "1")).toBe(false);
    expect(validMonthDay("1", "0")).toBe(false);
  });
  it("제목·날짜·구성원 오류가 필드별로", () => {
    let d = good();
    const key = d.anniversaries[0]!.key;
    d = updateAnniversary(d, key, { title: "", month: "4", day: "31", member: "ghost" });
    const e = validateAnniversaries(d);
    expect(e[`anniv.${key}.title`]).toBeDefined();
    expect(e[`anniv.${key}.date`]).toBeDefined();
    expect(e[`anniv.${key}.member`]).toBeDefined();
    expect(validateAnniversaries(updateAnniversary(d, key, { title: "기념일 #1", month: "1", day: "1", member: "family" }))[`anniv.${key}.title`]).toMatch(/#/);
  });
  it("생일이 있는 구성원마다 '이름 생일' 기념일이 자동으로 생긴다 (제목에 '생일' 포함, 이름 없으면 제외)", () => {
    const list = birthdayAnniversaries(good().members);
    expect(list).toEqual([
      { monthDay: "03-12", title: "엄마 생일", member: "member-1" },
      { monthDay: "08-15", title: "하늘 생일", member: "member-2" },
    ]);
    expect(birthdayAnniversaries(updateMember(good(), "m2", { birth: "" }).members)).toHaveLength(1);
  });
});

describe("5단계: 캘린더 ID 형식", () => {
  const e = (calendarId: string) => validateCalendar({ ...good(), calendarId }).calendarId;
  it("비어 있으면 통과(선택)", () => expect(e("")).toBeUndefined());
  it("메일 주소 모양만 통과", () => {
    expect(e("abc123@group.calendar.google.com")).toBeUndefined();
    expect(e("me@gmail.com")).toBeUndefined();
    expect(e("primary")).toMatch(/메일 주소/);
    expect(e("내 캘린더")).toBeDefined();
    expect(e("a b@gmail.com")).toBeDefined();
  });
});

describe("검증 통과 = 서버 스키마 통과", () => {
  it("모든 단계가 통과한 draft는 setupSchema도 통과한다", () => {
    const d = good();
    expect(validateStep(d, 6, NOW)).toEqual({});
    const r = setupSchema.safeParse(toSetupInput(d));
    expect(r.success, JSON.stringify(r.success ? "" : r.error.issues)).toBe(true);
  });

  it("직접 입력 지역 + 캘린더도 통과", () => {
    const d: Draft = { ...good(), regionMode: "manual", manual: { label: "부산 해운대", nx: "99", ny: "75", landId: "11H20000", taId: "11H20201" }, calendarId: "abc@group.calendar.google.com" };
    expect(validateStep(d, 6, NOW)).toEqual({});
    expect(setupSchema.safeParse(toSetupInput(d)).success).toBe(true);
  });

  it("클라이언트가 막은 입력을 서버 스키마도 막는다 (대표 위반 모음)", () => {
    const bads: Draft[] = [
      { ...good(), familyName: "" },
      { ...good(), regionKey: "" },
      updateMember(good(), "m1", { id: "family" }),
      updateMember(good(), "m2", { id: "MEMBER-1" }),
      updateMember(good(), "m2", { id: "Con" }),
      updateMember(good(), "m1", { role: "child" }),
      updateAnniversary(good(), good().anniversaries[0]!.key, { month: "2", day: "30" }),
      { ...good(), calendarId: "primary" },
    ];
    for (const d of bads) {
      const hasClientError = Object.keys(validateStep(d, 6, NOW)).length > 0;
      expect(hasClientError).toBe(true);
    }
    // 서버 스키마는 지역 누락만은 허용(필드가 없는 것)이므로 위 항목 중 server에서도 막혀야 하는 것만 확인
    for (const d of bads.filter((x) => x.regionKey !== "")) {
      const input = toSetupInput(d);
      if (d.anniversaries[0]?.month === "2") continue; // 날짜가 잘못된 기념일은 toSetupInput이 제외
      if (d.familyName === "") continue;
      expect(setupSchema.safeParse(input).success, JSON.stringify(input.members)).toBe(false);
    }
  });

  it("추가 기념일 행은 유효한 날짜만, draft key와 짝으로 돌려준다", () => {
    const d = good();
    const key = d.anniversaries[0]!.key;
    const bad = addAnniversary(d, { title: "없는 날", month: "2", day: "30", member: "family" });
    const rows = extraAnniversaryRows(bad);
    expect(rows.map((r) => r.key)).toEqual([key]);
    expect(rows.map((r) => r.anniversary)).toEqual(extraAnniversaries(bad));
  });

  it("firstErrorStep·stepOfField", () => {
    expect(stepOfField("familyName")).toBe(1);
    expect(stepOfField("manual.nx")).toBe(1);
    expect(stepOfField("members")).toBe(2);
    expect(stepOfField("member.m1.name")).toBe(2);
    expect(stepOfField("anniv.a3.title")).toBe(4);
    expect(stepOfField("calendarId")).toBe(5);
    expect(stepOfField("overwrite")).toBe(6);
    expect(stepOfField("form")).toBe(6);
    expect(firstErrorStep({ calendarId: "x", "member.m1.id": "y" })).toBe(2);
    expect(firstErrorStep({})).toBeUndefined();
  });
});

describe("toSetupInput / 서버 오류 경로 매핑 / 미리보기", () => {
  it("기념일은 생일 자동 + 직접 추가를 MM-DD로 합친다 (월·일 한 자리는 0 채움)", () => {
    const d = updateAnniversary(good(), good().anniversaries[0]!.key, { month: "3", day: "5" });
    expect(toSetupInput(d).anniversaries.map((a) => a.monthDay)).toEqual(["03-12", "08-15", "03-05"]);
  });

  it("지역 목록 선택은 config에 격자·코드가 들어가고, 가족 색은 gray", () => {
    expect(toSetupInput(good()).config).toMatchObject({ region: "서울특별시 마포구", kmaNx: 59, kmaNy: 127, kmaMidLandRegId: "11B00000", kmaMidTaRegId: "11B10101", familyColor: "gray", timezone: "Asia/Seoul" });
  });

  it("서버 오류 경로를 화면 필드로 바꾼다", () => {
    const d = good();
    const aKey = d.anniversaries[0]!.key;
    const e = serverIssuesToErrors(d, [
      { path: "config.familyName", message: "A" },
      { path: "members.1.id", message: "B" },
      { path: "members", message: "C" },
      { path: "anniversaries.0.monthDay", message: "D" }, // 0번 = 엄마 생일
      { path: "anniversaries.2.title", message: "E" }, // 2번 = 직접 추가 첫 항목
      { path: "config.kmaNx", message: "F" },
      { path: "unknown.path", message: "G" },
    ]);
    expect(e).toEqual({ familyName: "A", "member.m2.id": "B", members: "C", "member.m1.birth": "D", [`anniv.${aKey}.title`]: "E", region: "F", form: "G" });
  });

  it("직접 입력 지역의 서버 오류는 직접 입력 칸으로", () => {
    const d: Draft = { ...good(), regionMode: "manual" };
    expect(serverIssuesToErrors(d, [{ path: "config.kmaNy", message: "x" }, { path: "config.kmaMidTaRegId", message: "y" }])).toEqual({ "manual.ny": "x", "manual.taId": "y" });
  });

  it("미리보기 상태: 가족 이름·구성원(가족 전체 포함)·기념일 D-day, 일정은 없음", () => {
    const p = toPreviewState(good(), NOW);
    expect(p.familyName).toBe("햇살네");
    expect(p.members.map((m) => m.id)).toEqual(["member-1", "member-2", "family"]);
    expect(p.anniversaries).toHaveLength(3);
    expect(p.events).toEqual([]);
    expect(p.needsSetup).toBe(false);
    // 생일에는 나이(turns)가 붙는다: 다음 하늘 생일 2027-08-15, 7살
    expect(p.anniversaries.find((a) => a.title === "하늘 생일")?.turns).toEqual({ date: "2027-08-15", age: 7 });
    // 공개 응답에 생일 원문은 없다
    expect(JSON.stringify(p)).not.toContain("2020-08-15");
  });
});
