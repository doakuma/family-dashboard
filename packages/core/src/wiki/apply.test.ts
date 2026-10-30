import { describe, expect, it } from "vitest";
import { DEFAULT_FAMILY_ID, needsSetup, type Change } from "../types";
import { ChangeError, applyChange, type WikiFiles } from "./apply";
import { readWiki } from "./read";

function memWiki(init: Record<string, string>) {
  const store = new Map(Object.entries(init));
  const files: WikiFiles = {
    read: (p) => store.get(p),
    list: (dir) =>
      [...store.keys()]
        .filter((k) => k.startsWith(`${dir}/`))
        .map((k) => k.slice(dir.length + 1))
        .sort(),
  };
  const commit = (c: Change, seed = 0.5) => {
    let n = seed;
    const r = applyChange(files, c, () => (n = (n + 0.137) % 1));
    for (const [k, v] of r.files) store.set(k, v);
    return r;
  };
  return { store, files, commit };
}

const base = {
  "events/2026-11.md": "- [ ] 2026-11-03 15:00-16:00 치과 검진 @haneul #evt-a1b2\n- [ ] 2026-11-07 종일 가을 소풍 @family #evt-c3d4\n",
  "tasks.md": "## 장보기\n- [ ] 우유 #task-e5f6\n\n## 할 일\n- [x] 책 반납하기 @haneul #task-g7h8\n",
  "anniversaries.md": "<!-- 설명 -->\n- 08-15 하늘 생일 @haneul\n- 12-25 크리스마스 @family\n",
};

describe("applyChange", () => {
  it("event.add: 시간순 자리에 넣고 새 id를 붙인다", () => {
    const w = memWiki(base);
    const r = w.commit({
      kind: "event.add",
      payload: { date: "2026-11-05", start: "10:00", allDay: false, title: "장 보기", members: ["mom"] },
    });
    expect(r.id).toMatch(/^evt-[0-9a-f]{4}$/);
    expect(w.store.get("events/2026-11.md")?.split("\n")[1]).toBe(`- [ ] 2026-11-05 10:00 장 보기 @mom #${r.id}`);
    expect(r.summary).toBe("일정 추가: 2026-11-05 10:00 장 보기");
  });

  it("event.add: 새 달이면 새 파일을 만든다", () => {
    const w = memWiki(base);
    const r = w.commit({ kind: "event.add", payload: { date: "2026-12-24", allDay: true, title: "이브", members: ["family"] } });
    expect(w.store.get("events/2026-12.md")).toBe(`- [ ] 2026-12-24 종일 이브 @family #${r.id}\n`);
  });

  it("event.update: 시간 변경", () => {
    const w = memWiki(base);
    w.commit({ kind: "event.update", payload: { id: "evt-a1b2", start: "16:00", end: "17:00" } });
    expect(w.store.get("events/2026-11.md")).toContain("- [ ] 2026-11-03 16:00-17:00 치과 검진 @haneul #evt-a1b2");
  });

  it("event.update: 다른 필드를 고쳐도 &share가 남는다, patch의 share는 무시", () => {
    const w = memWiki({ ...base, "events/2026-11.md": `${base["events/2026-11.md"]}- [ ] 2026-11-15 12:00-14:00 사촌 모임 점심 @family &cousins #evt-i9j0\n` });
    w.commit({ kind: "event.update", payload: { id: "evt-i9j0", start: "13:00", end: "15:00" } });
    expect(w.store.get("events/2026-11.md")).toContain("- [ ] 2026-11-15 13:00-15:00 사촌 모임 점심 @family &cousins #evt-i9j0");
    w.commit({ kind: "event.update", payload: { id: "evt-i9j0", date: "2026-12-01", share: "other" } } as unknown as Change);
    expect(w.store.get("events/2026-12.md")).toContain("2026-12-01 13:00-15:00 사촌 모임 점심 @family &cousins #evt-i9j0");
    expect(readWiki(w.files, DEFAULT_FAMILY_ID).events.find((e) => e.id === "evt-i9j0")?.share).toBe("cousins");
  });

  it("event.update: 깨진 &토큰도 원문 그대로 남는다", () => {
    for (const tail of ["&Cousins", "&a &b", "&", "&bad!"]) {
      const line = `- [ ] 2026-11-15 12:00-14:00 점심 @family ${tail} #evt-i9j0`;
      const w = memWiki({ ...base, "events/2026-11.md": `${base["events/2026-11.md"]}${line}\n` });
      w.commit({ kind: "event.update", payload: { id: "evt-i9j0", start: "13:00", end: "15:00" } });
      expect(w.store.get("events/2026-11.md")).toContain(`- [ ] 2026-11-15 13:00-15:00 점심 @family ${tail} #evt-i9j0`);
    }
  });

  it("event.update: 깨진 &토큰 일정을 다른 달로 옮겨도 원문이 남는다", () => {
    const w = memWiki({ ...base, "events/2026-11.md": `${base["events/2026-11.md"]}- [ ] 2026-11-15 12:00 점심 @family &a &b #evt-i9j0\n` });
    w.commit({ kind: "event.update", payload: { id: "evt-i9j0", date: "2026-12-01" } });
    expect(w.store.get("events/2026-12.md")).toContain("2026-12-01 12:00 점심 @family &a &b #evt-i9j0");
    expect(w.store.get("events/2026-11.md")).not.toContain("evt-i9j0");
  });

  it("event.add: payload의 share는 무시되고, 제목의 &토큰은 거부", () => {
    const w = memWiki(base);
    const r = w.commit({ kind: "event.add", payload: { date: "2026-11-05", allDay: true, title: "점심", members: ["mom"], share: "x" } } as unknown as Change);
    expect(w.store.get("events/2026-11.md")).toContain(`2026-11-05 종일 점심 @mom #${r.id}`);
    expect(() => w.commit({ kind: "event.add", payload: { date: "2026-11-05", allDay: true, title: "점심 &cousins", members: ["mom"] } })).toThrow(ChangeError);
  });

  it("event.update: 다른 달로 옮기면 파일도 옮긴다, 종일로 바꾸면 시간을 지운다", () => {
    const w = memWiki(base);
    w.commit({ kind: "event.update", payload: { id: "evt-a1b2", date: "2026-12-01", allDay: true } });
    expect(w.store.get("events/2026-11.md")).not.toContain("evt-a1b2");
    expect(w.store.get("events/2026-12.md")).toBe("- [ ] 2026-12-01 종일 치과 검진 @haneul #evt-a1b2\n");
  });

  it("event.remove / 없는 id는 not_found", () => {
    const w = memWiki(base);
    w.commit({ kind: "event.remove", payload: { id: "evt-c3d4" } });
    expect(w.store.get("events/2026-11.md")).not.toContain("evt-c3d4");
    expect(() => w.commit({ kind: "event.remove", payload: { id: "evt-zzzz" } })).toThrow(ChangeError);
  });

  it("task.add: 섹션 끝(빈 줄 앞)에 넣는다, 섹션이 없으면 만든다", () => {
    const w = memWiki(base);
    const a = w.commit({ kind: "task.add", payload: { list: "shopping", title: "사과" } });
    expect(w.store.get("tasks.md")).toBe(
      `## 장보기\n- [ ] 우유 #task-e5f6\n- [ ] 사과 #${a.id}\n\n## 할 일\n- [x] 책 반납하기 @haneul #task-g7h8\n`,
    );
    const w2 = memWiki({});
    const b = w2.commit({ kind: "task.add", payload: { list: "todo", title: "택배 반품", member: "dad" } });
    expect(w2.store.get("tasks.md")).toBe(`## 할 일\n- [ ] 택배 반품 @dad #${b.id}\n`);
  });

  it("task.done", () => {
    const w = memWiki(base);
    w.commit({ kind: "task.done", payload: { id: "task-e5f6" } });
    expect(w.store.get("tasks.md")).toContain("- [x] 우유 #task-e5f6");
    expect(() => w.commit({ kind: "task.done", payload: { id: "task-none" } })).toThrow(/찾을 수 없어요/);
  });

  it("anniversary.add: 날짜순, 주석 유지", () => {
    const w = memWiki(base);
    w.commit({ kind: "anniversary.add", payload: { monthDay: "11-21", title: "결혼기념일", member: "family" } });
    expect(w.store.get("anniversaries.md")).toBe(
      "<!-- 설명 -->\n- 08-15 하늘 생일 @haneul\n- 11-21 결혼기념일 @family\n- 12-25 크리스마스 @family\n",
    );
  });

  it("쓴 결과를 다시 읽으면 같은 상태가 나온다", () => {
    const w = memWiki(base);
    const r = w.commit({ kind: "event.add", payload: { date: "2026-11-03", start: "09:00", allDay: false, title: "등원", members: ["haneul"] } });
    const s = readWiki(w.files, DEFAULT_FAMILY_ID);
    expect(s.events.map((e) => e.id)).toEqual([r.id, "evt-a1b2", "evt-c3d4"]);
  });
});

describe("readWiki", () => {
  it("구성원이 없으면 members는 비어 있다(→ 세팅 화면)", () => {
    expect(readWiki(memWiki(base).files, DEFAULT_FAMILY_ID).members).toEqual([]);
  });

  it("구성원이 있으면 '가족'을 덧붙인다", () => {
    const w = memWiki({ ...base, "members/haneul.md": "---\nid: haneul\nname: 하늘\nrole: child\ncolor: blue\n---\n" });
    expect(readWiki(w.files, DEFAULT_FAMILY_ID).members.map((m) => m.id)).toEqual(["haneul", "family"]);
  });

  it("값 하나가 깨져도 구성원·config는 살고, 경고는 파일 이름과 함께 모이며, 세팅 필요로 바뀌지 않는다", () => {
    const w = memWiki({
      ...base,
      "config.md": "---\nfamilyName: 햇살네\nfamilyColor: Gray\nsetupCompletedAt: 깨진 값\n---\n",
      "members/haneul.md": "---\nid: haneul\nname: 하늘\nrole: child\ncolor: Blue\nslack: U00-DAD\n---\n",
      "members/bad.md": "---\nname: 아이디 없음\n---\n",
    });
    const s = readWiki(w.files, DEFAULT_FAMILY_ID);
    expect(s.config).toMatchObject({ familyName: "햇살네", familyColor: "gray", setupCompletedAt: undefined });
    expect(s.members.map((m) => m.id)).toEqual(["haneul", "family"]);
    expect(s.members[0]).toMatchObject({ color: "gray", slackId: undefined });
    expect(needsSetup(s)).toBe(false);
    expect(s.warnings.filter((x) => x.startsWith("config.md:"))).toHaveLength(2);
    expect(s.warnings.filter((x) => x.startsWith("members/haneul.md:"))).toHaveLength(2);
    expect(s.warnings.filter((x) => x.startsWith("members/bad.md:"))).toHaveLength(1);
  });

  it("정상 위키는 경고가 없다", () => {
    expect(readWiki(memWiki(base).files, DEFAULT_FAMILY_ID).warnings).toEqual([]);
  });

  describe("형식 보호 (applyChange가 스스로 검증한다)", () => {
    const bad = (c: unknown) => () => applyChange(memWiki(base).files, c as Change);

    it("제목의 줄바꿈으로 줄을 끼워 넣을 수 없다", () => {
      const c = { kind: "task.add", payload: { list: "todo", title: "책\n- [ ] 가짜 #task-0001" } };
      expect(bad(c)).toThrow(ChangeError);
      expect(bad({ kind: "task.add", payload: { list: "todo", title: "a\u2028b" } })).toThrow(ChangeError);
    });

    it("제목의 #task-/#evt- id 토큰을 거부한다", () => {
      expect(bad({ kind: "task.add", payload: { list: "todo", title: "우유 #task-e5f6" } })).toThrow(/올바르지 않은/);
      expect(bad({ kind: "event.add", payload: { date: "2026-11-05", allDay: true, title: "x #evt-a1b2", members: ["mom"] } })).toThrow(ChangeError);
    });

    it("allDay=false인데 start가 없으면 거부", () => {
      expect(bad({ kind: "event.add", payload: { date: "2026-11-05", allDay: false, title: "치과", members: ["mom"] } })).toThrow(/start/);
    });

    it("end <= start 거부 (추가·수정 모두)", () => {
      const p = { date: "2026-11-05", allDay: false, start: "10:00", end: "09:00", title: "치과", members: ["mom"] };
      expect(bad({ kind: "event.add", payload: p })).toThrow(/end/);
      expect(bad({ kind: "event.add", payload: { ...p, end: "10:00" } })).toThrow(/end/);
      // 수정: 기존 시작(15:00)보다 이른 끝 시간만 주면 합친 결과가 잘못
      expect(bad({ kind: "event.update", payload: { id: "evt-a1b2", end: "14:00" } })).toThrow(ChangeError);
      expect(bad({ kind: "event.update", payload: { id: "evt-c3d4", allDay: false } })).toThrow(/시작 시간/);
    });

    it("없는 날짜·잘못된 구성원 id 거부", () => {
      expect(bad({ kind: "event.add", payload: { date: "2026-02-31", allDay: true, title: "x", members: ["mom"] } })).toThrow(ChangeError);
      expect(bad({ kind: "task.add", payload: { list: "todo", title: "x", member: "하늘 이" } })).toThrow(ChangeError);
    });
  });
});
