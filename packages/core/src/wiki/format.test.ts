import { describe, expect, it } from "vitest";
import {
  formatEventLine,
  formatTaskLine,
  parseAnniversariesFile,
  parseConfigFile,
  parseEventLine,
  parseEventsFile,
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

  it("구성원 프론트매터 (앞 주석 허용, role 기본값 guardian)", () => {
    const m = parseMemberFile("<!-- members/haneul.md -->\n---\nid: haneul\nname: 하늘\nrole: child\nbirth: 2020-08-15\ncolor: blue\nslack: U0123ABC\n---\n");
    expect(m).toEqual({ id: "haneul", name: "하늘", role: "child", birth: "2020-08-15", color: "blue", slackId: "U0123ABC" });
    expect(parseMemberFile("---\nid: mom\nname: 엄마\n---\n")?.role).toBe("guardian");
    expect(parseMemberFile("이름 없음")).toBeNull();
  });

  it("config.md", () => {
    const c = parseConfigFile("---\nfamilyName: 햇살네\nkmaNx: 59\nkmaNy: 127\nsetupCompletedAt: 2026-11-01T10:00:00+09:00\n---\n");
    expect(c).toMatchObject({ familyName: "햇살네", timezone: "Asia/Seoul", kmaNx: 59, kmaNy: 127, familyColor: "gray" });
    expect(parseConfigFile("---\nregion: 서울\n---\n")).toBeNull();
  });
});
