import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_REGIONS, findRegion, regionToConfigFields, REGION_GROUPS, KMA_REG_ID_RE } from "../regions";
import { setupSchema } from "../schema";
import type { SetupInput } from "../types";
import type { WikiFiles } from "./apply";
import { parseAnniversariesFile, parseConfigFile, parseMemberFile } from "./format";
import { SetupError, buildSetupFiles, hasExistingSetupContent } from "./setup";

const filesOf = (m: Record<string, string>): WikiFiles => ({
  read: (p) => m[p],
  list: (dir) => Object.keys(m).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)).sort(),
});

const mapo = findRegion("seoul-mapo")!;
const valid = (): SetupInput => ({
  config: { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray", ...regionToConfigFields(mapo) },
  members: [
    { id: "mom", name: "엄마", role: "guardian", color: "coral", birth: "1988-03-12" },
    { id: "haneul", name: "하늘", role: "child", color: "blue", birth: "2020-08-15" },
  ],
  anniversaries: [
    { monthDay: "11-21", title: "결혼기념일", member: "family" },
    { monthDay: "03-12", title: "엄마 생일", member: "mom" },
  ],
});
const AT = "2026-10-30T20:00:00+09:00";

describe("지역표", () => {
  it("모든 지역이 범위·형식을 지킨다 (키 유일, 격자 범위, 코드 형식)", () => {
    expect(new Set(ALL_REGIONS.map((r) => r.key)).size).toBe(ALL_REGIONS.length);
    expect(new Set(ALL_REGIONS.map((r) => r.label)).size).toBe(ALL_REGIONS.length);
    for (const r of ALL_REGIONS) {
      expect(r.nx, r.key).toBeGreaterThanOrEqual(1);
      expect(r.nx, r.key).toBeLessThanOrEqual(149);
      expect(r.ny, r.key).toBeGreaterThanOrEqual(1);
      expect(r.ny, r.key).toBeLessThanOrEqual(253);
      expect(r.midLandRegId, r.key).toMatch(KMA_REG_ID_RE);
      expect(r.midTaRegId, r.key).toMatch(KMA_REG_ID_RE);
      expect(r.label.startsWith(REGION_GROUPS.find((g) => g.regions.includes(r))!.name), r.key).toBe(true);
    }
  });

  it("서울 25개 구가 모두 있고, 서울·인천·경기 육상 예보구역은 11B00000", () => {
    expect(REGION_GROUPS[0]!.regions).toHaveLength(25);
    expect(ALL_REGIONS.every((r) => r.midLandRegId === "11B00000")).toBe(true);
    expect(REGION_GROUPS[0]!.regions.every((r) => r.midTaRegId === "11B10101")).toBe(true);
  });

  it("예시 위키(fixtures/sample-wiki/config.md)의 마포구 값과 같다 (nx 59, ny 127, 11B00000, 11B10101)", () => {
    const sample = parseConfigFile(readFileSync(join(import.meta.dirname, "../../../../fixtures/sample-wiki/config.md"), "utf8"))!;
    const f = regionToConfigFields(mapo);
    expect(f).toMatchObject({ kmaNx: sample.kmaNx, kmaNy: sample.kmaNy, kmaMidLandRegId: sample.kmaMidLandRegId, kmaMidTaRegId: sample.kmaMidTaRegId });
    expect(f).toEqual({ region: "서울특별시 마포구", kmaNx: 59, kmaNy: 127, kmaMidLandRegId: "11B00000", kmaMidTaRegId: "11B10101" });
  });

  it("지역 -> config 필드는 쓰기 스키마를 통과한다 (전 지역)", () => {
    for (const r of ALL_REGIONS) {
      const s = valid();
      s.config = { ...s.config, ...regionToConfigFields(r) };
      expect(setupSchema.safeParse(s).success, r.key).toBe(true);
    }
  });

  it("없는 키는 undefined", () => {
    expect(findRegion("nowhere")).toBeUndefined();
    expect(findRegion(undefined)).toBeUndefined();
  });
});

describe("setupSchema", () => {
  const bad = (mut: (s: SetupInput) => void) => {
    const s = valid();
    mut(s);
    const r = setupSchema.safeParse(s);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("정상 값 통과", () => {
    expect(setupSchema.safeParse(valid()).success).toBe(true);
  });

  it("구성원 id 중복(대소문자 무시)·예약 id family 거부", () => {
    expect(bad((s) => void (s.members[1]!.id = "MOM"))).toContain("members.1.id");
    expect(bad((s) => void (s.members[1]!.id = "family"))).toContain("members.1.id");
    expect(bad((s) => void (s.members[1]!.id = "하늘"))).toContain("members.1.id");
  });

  it("구성원 id는 32자까지", () => {
    expect(bad((s) => void (s.members[1]!.id = "a".repeat(33)))).toContain("members.1.id");
    const s = valid();
    s.members[1]!.id = "a".repeat(32);
    expect(setupSchema.safeParse(s).success).toBe(true);
  });

  it("보호자가 없거나 구성원이 없으면 거부", () => {
    expect(bad((s) => void (s.members[0]!.role = "child"))).toContain("members");
    expect(bad((s) => void (s.members = []))).toContain("members");
  });

  it("기념일: 없는 날(04-31), 등록 안 된 구성원 거부, 2월 29일·family는 허용", () => {
    expect(bad((s) => void (s.anniversaries[0]!.monthDay = "04-31"))).toContain("anniversaries.0.monthDay");
    expect(bad((s) => void (s.anniversaries[0]!.member = "ghost"))).toContain("anniversaries.0.member");
    expect(bad((s) => void (s.anniversaries[1]!.member = "MOM"))).toContain("anniversaries.1.member"); // 정확히 일치해야 한다
    const s = valid();
    s.anniversaries[0]!.monthDay = "02-29";
    expect(setupSchema.safeParse(s).success).toBe(true);
  });

  it("지역 값: 범위 밖 격자, 형식 틀린 코드, 일부만 있는 경우 거부", () => {
    expect(bad((s) => void (s.config.kmaNx = 0))).toContain("config.kmaNx");
    expect(bad((s) => void (s.config.kmaNy = 254))).toContain("config.kmaNy");
    expect(bad((s) => void (s.config.kmaMidLandRegId = "seoul"))).toContain("config.kmaMidLandRegId");
    expect(bad((s) => void (s.config.kmaMidTaRegId = undefined))).toContain("config.kmaNx");
    expect(bad((s) => void (s.config.kmaNx = 59.5))).toContain("config.kmaNx");
  });

  it("지역을 아예 안 넣는 것은 허용 (전부 없음)", () => {
    const s = valid();
    s.config = { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray" };
    expect(setupSchema.safeParse(s).success).toBe(true);
  });

  it("캘린더 ID는 메일 주소 꼴만, 공백·형식 틀림 거부", () => {
    expect(bad((s) => void (s.config.calendarId = "abc123@group.calendar.google.com"))).toEqual([]);
    expect(bad((s) => void (s.config.calendarId = "내 캘린더"))).toContain("config.calendarId");
    expect(bad((s) => void (s.config.calendarId = "a b@gmail.com"))).toContain("config.calendarId");
    expect(bad((s) => void (s.config.calendarId = "primary"))).toContain("config.calendarId");
  });

  it("제목에 위키 토큰 문자(#, @, &토큰), 줄바꿈 거부", () => {
    expect(bad((s) => void (s.anniversaries[0]!.title = "기념일 #1"))).toContain("anniversaries.0.title");
    expect(bad((s) => void (s.anniversaries[0]!.title = "a\nb"))).toContain("anniversaries.0.title");
    expect(bad((s) => void (s.config.familyName = "햇살\n네"))).toContain("config.familyName");
  });

  it("따옴표로 감싼 이름·지역은 거부 (위키 프론트매터가 읽을 때 달라진다)", () => {
    expect(bad((s) => void (s.config.familyName = '"햇살네"'))).toContain("config.familyName");
    expect(bad((s) => void (s.members[0]!.name = "'엄마'"))).toContain("members.0.name");
    expect(bad((s) => void (s.config.region = '"서울"'))).toContain("config.region");
  });

  it("알 수 없는 시간대 거부", () => {
    expect(bad((s) => void (s.config.timezone = "Mars/Base"))).toContain("config.timezone");
  });
});

describe("buildSetupFiles", () => {
  it("빈 위키: config + 구성원 파일 + 기념일(MM-DD 순)을 만들고, 읽으면 같은 값", () => {
    const r = buildSetupFiles(filesOf({}), valid(), AT);
    expect([...r.files.keys()].sort()).toEqual(["anniversaries.md", "config.md", "members/haneul.md", "members/mom.md"]);
    expect(parseConfigFile(r.files.get("config.md")!)).toMatchObject({ familyName: "햇살네", region: "서울특별시 마포구", kmaNx: 59, setupCompletedAt: AT });
    expect(parseMemberFile(r.files.get("members/mom.md")!)).toMatchObject({ id: "mom", role: "guardian", color: "coral", birth: "1988-03-12" });
    expect(r.files.get("anniversaries.md")).toBe("- 03-12 엄마 생일 @mom\n- 11-21 결혼기념일 @family\n");
    expect(parseAnniversariesFile(r.files.get("anniversaries.md")!)).toHaveLength(2);
    expect(r.summary).toBe("가족 세팅: 햇살네 (구성원 2명, 기념일 2건)");
  });

  it("기념일이 없으면 anniversaries.md를 만들지 않는다", () => {
    const s = valid();
    s.anniversaries = [];
    expect([...buildSetupFiles(filesOf({}), s, AT).files.keys()]).not.toContain("anniversaries.md");
  });

  it("같은 기념일이 겹치면 한 줄만", () => {
    const s = valid();
    s.anniversaries.push({ ...s.anniversaries[0]! });
    expect(buildSetupFiles(filesOf({}), s, AT).files.get("anniversaries.md")!.trim().split("\n")).toHaveLength(2);
  });

  it("검증 실패는 invalid + 필드 경로", () => {
    const s = valid();
    s.members[1]!.id = "mom";
    try {
      buildSetupFiles(filesOf({}), s, AT);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SetupError);
      expect((e as SetupError).code).toBe("invalid");
      expect((e as SetupError).issues.map((i) => i.path)).toContain("members.1.id");
    }
  });

  it("이미 세팅이 끝난 위키는 already_done (덮어쓰기 확인과 상관없이)", () => {
    const done = buildSetupFiles(filesOf({}), valid(), AT);
    const wiki: Record<string, string> = {};
    for (const [k, v] of done.files) if (v !== null) wiki[k] = v;
    for (const overwrite of [false, true]) {
      expect(() => buildSetupFiles(filesOf(wiki), valid(), AT, { overwrite })).toThrow(expect.objectContaining({ code: "already_done" }));
    }
  });

  it("세팅 전이지만 구성원 파일이 남아 있으면 확인 없이는 needs_confirm, 확인하면 이전 구성원 파일을 지운다", () => {
    const wiki = { "members/old.md": "---\nid: old\nname: 옛날\nrole: child\n---\n", "anniversaries.md": "- 01-01 새해\n" }; // config 없음 = 세팅 필요
    expect(hasExistingSetupContent(filesOf(wiki))).toBe(true);
    expect(() => buildSetupFiles(filesOf(wiki), valid(), AT)).toThrow(expect.objectContaining({ code: "needs_confirm" }));
    const r = buildSetupFiles(filesOf(wiki), valid(), AT, { overwrite: true });
    expect(r.files.get("members/old.md")).toBeNull();
    expect(r.files.get("anniversaries.md")).toContain("엄마 생일"); // 이전 기념일은 대체
    expect(r.files.get("anniversaries.md")).not.toContain("새해");
  });

  it("남은 파일이 tasks.md·events뿐이면 확인 없이 쓴다 (세팅 파일이 아니다)", () => {
    const wiki = { "tasks.md": "## 장보기\n", "events/2026-11.md": "" };
    expect(hasExistingSetupContent(filesOf(wiki))).toBe(false);
    const r = buildSetupFiles(filesOf(wiki), valid(), AT);
    expect([...r.files.keys()]).not.toContain("tasks.md");
  });

  it("덮어쓸 기념일이 없어지면 남은 anniversaries.md는 삭제", () => {
    const s = valid();
    s.anniversaries = [];
    const r = buildSetupFiles(filesOf({ "anniversaries.md": "- 01-01 새해\n" }), s, AT, { overwrite: true });
    expect(r.files.get("anniversaries.md")).toBeNull();
  });
});
