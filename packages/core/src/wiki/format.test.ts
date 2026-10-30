import { describe, expect, it } from "vitest";
import { stringifyFrontmatter } from "./frontmatter";
import {
  formatEventLine,
  formatTaskLine,
  parseAnniversariesFile,
  parseConfigFile,
  parseEventLine,
  parseEventsFile,
  formatConfigFile,
  formatMemberFile,
  parseMemberFile,
  parseTasksFile,
} from "./format";

describe("일정 줄", () => {
  it("시간 범위·구성원·id를 읽는다", () => {
    expect(parseEventLine("- [ ] 2026-11-03 15:00-16:00 치과 검진 @haneul #evt-a1b2")).toEqual({
      id: "evt-a1b2",
      date: "2026-11-03",
      start: "15:00",
      end: "16:00",
      allDay: false,
      title: "치과 검진",
      members: ["haneul"],
      done: false,
    });
  });

  it("종일 일정, 여러 구성원, 완료 표시", () => {
    const e = parseEventLine("- [x] 2026-11-07 종일 가족 가을 소풍 @mom @haneul #evt-c3d4");
    expect(e).toMatchObject({ allDay: true, start: undefined, title: "가족 가을 소풍", members: ["mom", "haneul"], done: true });
  });

  it("시작 시간만 있는 일정", () => {
    expect(parseEventLine("- [ ] 2026-11-04 09:30 회의 @dad #evt-0001")).toMatchObject({ start: "09:30", end: undefined });
  });

  it("형식이 깨진 줄은 무시한다", () => {
    expect(parseEventLine("- [ ] 2026-11-03 치과 @haneul #evt-a1b2")).toBeNull(); // 시간 없음
    expect(parseEventLine("- [ ] 2026-11-03 25:00 치과 #evt-a1b2")).toBeNull();
    expect(parseEventLine("- [ ] 2026-11-03 15:00 치과 @haneul")).toBeNull(); // id 없음
    expect(parseEventLine("<!-- 주석 -->")).toBeNull();
  });

  it("읽고 다시 쓰면 같은 줄이 된다", () => {
    for (const l of [
      "- [ ] 2026-11-03 15:00-16:00 치과 검진 @haneul #evt-a1b2",
      "- [x] 2026-11-07 종일 가족 가을 소풍 @family #evt-c3d4",
      "- [ ] 2026-11-04 09:30 회의 @dad @mom #evt-0001",
    ]) {
      const e = parseEventLine(l);
      expect(e && formatEventLine(e)).toBe(l);
    }
  });

  it("파일에서 일정 줄만 모은다", () => {
    const text = "<!-- 11월 -->\n- [ ] 2026-11-03 15:00 치과 @haneul #evt-a1b2\n\n메모 줄\n";
    expect(parseEventsFile(text)).toHaveLength(1);
  });
});

describe("tasks.md", () => {
  const text = "## 장보기\n- [ ] 우유 #task-e5f6\n- [ ] 사과 @mom #task-0002\n## 할 일\n- [x] 책 반납하기 @haneul #task-g7h8\n";

  it("섹션별로 읽는다", () => {
    expect(parseTasksFile(text)).toEqual([
      { id: "task-e5f6", list: "shopping", title: "우유", member: undefined, done: false },
      { id: "task-0002", list: "shopping", title: "사과", member: "mom", done: false },
      { id: "task-g7h8", list: "todo", title: "책 반납하기", member: "haneul", done: true },
    ]);
  });

  it("섹션 밖·모르는 섹션 항목은 무시한다", () => {
    expect(parseTasksFile("- [ ] 고아 #task-1111\n## 기타\n- [ ] 모름 #task-2222\n")).toEqual([]);
  });

  it("왕복 변환", () => {
    expect(formatTaskLine({ id: "task-0002", list: "shopping", title: "사과", member: "mom", done: false })).toBe(
      "- [ ] 사과 @mom #task-0002",
    );
  });
});

describe("기념일·구성원·config", () => {
  it("기념일", () => {
    expect(parseAnniversariesFile("<!-- 설명 -->\n- 08-15 하늘 생일 @haneul\n- 11-21 가족 기념일 @family\n- 13-01 잘못\n")).toEqual([
      { monthDay: "08-15", title: "하늘 생일", member: "haneul" },
      { monthDay: "11-21", title: "가족 기념일", member: "family" },
    ]);
  });

  it("구성원 프론트매터 (앞 주석 허용, role 없으면 child)", () => {
    const m = parseMemberFile("<!-- members/haneul.md -->\n---\nid: haneul\nname: 하늘\nrole: child\nbirth: 2020-08-15\ncolor: blue\nslack: U0123ABC\n---\n");
    expect(m).toEqual({ id: "haneul", name: "하늘", role: "child", birth: "2020-08-15", color: "blue", slackId: "U0123ABC" });
    expect(parseMemberFile("---\nid: mom\nname: 엄마\n---\n")?.role).toBe("child");
    expect(parseMemberFile("이름 없음")).toBeNull();
  });

  it("config.md", () => {
    const c = parseConfigFile("---\nfamilyName: 햇살네\nkmaNx: 59\nkmaNy: 127\nsetupCompletedAt: 2026-11-01T10:00:00+09:00\n---\n");
    expect(c).toMatchObject({ familyName: "햇살네", timezone: "Asia/Seoul", kmaNx: 59, kmaNy: 127, familyColor: "gray" });
    expect(parseConfigFile("---\nregion: 서울\n---\n")).toBeNull();
  });
});

describe("위키 형식 보호 (구성원·config)", () => {
  const member = { id: "haneul", name: "하늘", role: "child" as const, color: "blue" };

  it("정상 구성원은 왕복된다", () => {
    expect(parseMemberFile(formatMemberFile(member))).toEqual({ ...member, birth: undefined, slackId: undefined });
  });

  it("name에 줄바꿈으로 role을 끼워 넣는 쓰기를 거부한다", () => {
    expect(() => formatMemberFile({ ...member, name: "하늘\nrole: guardian" })).toThrow();
    expect(() => formatMemberFile({ ...member, color: "blue\nid: x" })).toThrow();
  });

  it("공백 있는 id·예약 id를 쓰기·읽기 양쪽에서 거부한다", () => {
    expect(() => formatMemberFile({ ...member, id: "하늘 이" })).toThrow();
    expect(() => formatMemberFile({ ...member, id: "family" })).toThrow();
    expect(parseMemberFile("---\nid: 하늘 이\nname: 하늘\n---\n")).toBeNull();
  });

  it("스키마를 거치지 않는 stringify도 줄바꿈 값을 거부한다", () => {
    expect(() => stringifyFrontmatter({ a: "x\nrole: child" })).toThrow(/줄바꿈/);
    expect(() => stringifyFrontmatter({ a: '"q"' })).toThrow();
  });

  it("config: 왕복과 잘못된 값 거부", () => {
    const cfg = { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray", kmaNx: 59, kmaNy: 127 };
    expect(parseConfigFile(formatConfigFile(cfg))).toMatchObject(cfg);
    expect(() => formatConfigFile({ ...cfg, familyName: "햇살\nfamilyColor: red" })).toThrow();
    expect(() => formatConfigFile({ ...cfg, timezone: "Mars/Base" })).toThrow();
    // 읽기는 필드 단위로 관용: 모르는 timezone은 기본값으로 읽는다(아래 '필드 단위 관용 읽기')
    expect(parseConfigFile("---\nfamilyName: 햇살네\ntimezone: Mars/Base\n---\n")?.timezone).toBe("Asia/Seoul");
  });
});

describe("필드 단위 관용 읽기 (스펙 rev 46)", () => {
  const collect = () => {
    const w: string[] = [];
    return { w, warn: (m: string) => w.push(m) };
  };

  it("구성원: color Blue -> gray, slack U00-DAD -> 없음. 나머지 필드와 파일은 살아남는다", () => {
    const { w, warn } = collect();
    const m = parseMemberFile("---\nid: haneul\nname: 하늘\nrole: child\nbirth: 2020-08-15\ncolor: Blue\nslack: U00-DAD\n---\n", warn);
    expect(m).toEqual({ id: "haneul", name: "하늘", role: "child", birth: "2020-08-15", color: "gray", slackId: undefined });
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/color.*Blue.*gray/);
    expect(w[1]).toMatch(/slack.*U00-DAD/);
  });

  it("구성원: 잘못된 birth·role도 그 필드만 대체", () => {
    const { w, warn } = collect();
    const m = parseMemberFile("---\nid: a\nname: 가\nrole: kid\nbirth: 2020-02-31\n---\n", warn);
    expect(m).toMatchObject({ id: "a", role: "child", birth: undefined, color: "gray" });
    expect(w.map((x) => x.split(":")[0])).toEqual(["role", "birth"]);
  });

  it("구성원: role이 없으면 child(최소 권한)로 읽고 경고", () => {
    const { w, warn } = collect();
    const m = parseMemberFile("---\nid: a\nname: 가\n---\n", warn);
    expect(m?.role).toBe("child");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/role.*child/);
  });

  it("구성원: role이 올바르면 경고 없이 그대로", () => {
    const { w, warn } = collect();
    expect(parseMemberFile("---\nid: a\nname: 가\nrole: guardian\n---\n", warn)?.role).toBe("guardian");
    expect(w).toEqual([]);
  });

  it("구성원: 필수값(id·name)이 깨지면 파일을 버린다", () => {
    for (const fm of ["id: 하늘 이\nname: 하늘", "id: family\nname: 가족", "id: a\nname:", "name: 이름만"]) {
      const { w, warn } = collect();
      expect(parseMemberFile(`---\n${fm}\n---\n`, warn), fm).toBeNull();
      expect(w, fm).toHaveLength(1);
    }
  });

  it("config: familyColor Gray -> gray, calendarId 'abc def' -> 없음, 깨진 setupCompletedAt -> 없음", () => {
    const { w, warn } = collect();
    const c = parseConfigFile(
      "---\nfamilyName: 햇살네\nregion: 서울\nfamilyColor: Gray\ncalendarId: abc def\nsetupCompletedAt: 어제 저녁\nkmaNx: 59\nkmaNy: 59.5\ntimezone: Mars/Base\n---\n",
      warn,
    );
    expect(c).toEqual({
      familyName: "햇살네",
      timezone: "Asia/Seoul",
      region: "서울",
      kmaNx: 59,
      kmaNy: undefined,
      kmaMidLandRegId: undefined,
      kmaMidTaRegId: undefined,
      familyColor: "gray",
      calendarId: undefined,
      setupCompletedAt: undefined,
    });
    expect(w.map((x) => x.split(":")[0]).sort()).toEqual(["calendarId", "familyColor", "kmaNy", "setupCompletedAt", "timezone"]);
  });

  it("config: familyName이 없거나 깨지면 버린다", () => {
    const { w, warn } = collect();
    expect(parseConfigFile("---\nregion: 서울\n---\n", warn)).toBeNull();
    expect(parseConfigFile("---\nfamilyName: \"\"\n---\n", warn)).toBeNull();
    expect(w).toHaveLength(2);
  });

  it("쓰기 스키마는 엄격 그대로", () => {
    const cfg = { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "Gray" };
    expect(() => formatConfigFile(cfg)).toThrow();
    expect(() => formatConfigFile({ ...cfg, familyColor: "gray", calendarId: "abc def" })).toThrow();
    expect(() => formatConfigFile({ ...cfg, familyColor: "gray", setupCompletedAt: "어제" })).toThrow();
    expect(() => formatMemberFile({ id: "a", name: "가", role: "child", color: "Blue" })).toThrow();
    expect(() => formatMemberFile({ id: "a", name: "가", role: "child", color: "blue", slackId: "U00-DAD" })).toThrow();
  });
});
