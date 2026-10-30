import { describe, expect, it } from "vitest";
import { DRAFT_KEY, MAX_MEMBERS, addAnniversary, addMember, clearDraft, initialDraft, loadDraft, removeAnniversary, removeMember, saveDraft, updateAnniversary, updateMember } from "./draft";

describe("구성원 추가·id·색", () => {
  it("처음에는 보호자 한 명, 색·id는 자동", () => {
    const d = initialDraft();
    expect(d.members).toHaveLength(1);
    expect(d.members[0]).toMatchObject({ role: "guardian", color: "coral", id: "member-1", idEdited: false });
  });

  it("추가한 구성원은 아이이고 색이 겹치지 않으며 id도 겹치지 않는다", () => {
    let d = initialDraft();
    for (let i = 0; i < 6; i++) d = addMember(d);
    expect(d.members).toHaveLength(7);
    expect(new Set(d.members.map((m) => m.color)).size).toBe(7);
    expect(new Set(d.members.map((m) => m.id)).size).toBe(7);
    expect(d.members[1]?.role).toBe("child");
    expect(new Set(d.members.map((m) => m.key)).size).toBe(7);
  });

  it("최대 인원을 넘기지 않고, 마지막 한 명은 지울 수 없다", () => {
    let d = initialDraft();
    for (let i = 0; i < 20; i++) d = addMember(d);
    expect(d.members).toHaveLength(MAX_MEMBERS);
    expect(removeMember(initialDraft(), "m1").members).toHaveLength(1);
  });

  it("이름을 바꾸면 id가 따라가고(영문 → slug, 한글 → member-N), 직접 고친 id는 유지", () => {
    let d = addMember(initialDraft());
    const [a, b] = d.members.map((m) => m.key) as [string, string];
    d = updateMember(d, a, { name: "Mom" });
    expect(d.members[0]?.id).toBe("mom");
    d = updateMember(d, b, { name: "하늘" });
    expect(d.members[1]?.id).toBe("member-1"); // 엄마(mom)는 member-N을 쓰지 않으니 비어 있는 가장 작은 번호
    d = updateMember(d, a, { id: "엄마id" }); // 값 자체는 검증이 거른다
    expect(d.members[0]).toMatchObject({ id: "엄마id", idEdited: true });
    d = updateMember(d, a, { name: "Mother" });
    expect(d.members[0]?.id).toBe("엄마id");
    d = updateMember(d, a, { id: "" }); // 비우면 다시 자동
    expect(d.members[0]).toMatchObject({ id: "mother", idEdited: false });
  });

  it("같은 영문 이름 두 명은 id가 mom, mom-2", () => {
    let d = addMember(initialDraft());
    d = updateMember(d, "m1", { name: "Mom" });
    d = updateMember(d, "m2", { name: "Mom" });
    expect(d.members.map((m) => m.id)).toEqual(["mom", "mom-2"]);
  });

  it("구성원 id가 바뀌거나 지워지면 그 구성원을 가리키던 기념일이 따라간다", () => {
    let d = updateMember(initialDraft(), "m1", { name: "Mom" });
    d = addAnniversary(d, { title: "엄마 입사일", member: "mom" });
    d = updateMember(d, "m1", { id: "mama" });
    expect(d.anniversaries[0]?.member).toBe("mama");
    d = removeMember(addMember(d), "m1");
    expect(d.anniversaries[0]?.member).toBe("family");
  });

  it("기념일 추가·수정·삭제", () => {
    let d = addAnniversary(initialDraft());
    const key = d.anniversaries[0]!.key;
    expect(d.anniversaries[0]).toMatchObject({ member: "family", title: "" });
    d = updateAnniversary(d, key, { title: "결혼기념일", month: "11", day: "21" });
    expect(d.anniversaries[0]).toMatchObject({ title: "결혼기념일", month: "11", day: "21" });
    expect(removeAnniversary(d, key).anniversaries).toEqual([]);
  });
});

describe("draft 저장 (sessionStorage)", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };

  it("저장하고 다시 읽으면 같다, 지우면 없다", () => {
    const s = memory();
    const d = { ...updateMember(initialDraft(), "m1", { name: "엄마" }), step: 3, familyName: "햇살네" };
    saveDraft(s, d);
    expect(loadDraft(s)).toEqual(d);
    clearDraft(s);
    expect(loadDraft(s)).toBeUndefined();
  });

  it("깨진 JSON·형식이 다른 값·범위 밖 단계는 무시", () => {
    const s = memory();
    s.setItem(DRAFT_KEY, "{not json");
    expect(loadDraft(s)).toBeUndefined();
    s.setItem(DRAFT_KEY, JSON.stringify({ ...initialDraft(), step: 9 }));
    expect(loadDraft(s)).toBeUndefined();
    s.setItem(DRAFT_KEY, JSON.stringify({ ...initialDraft(), members: [] }));
    expect(loadDraft(s)).toBeUndefined();
    s.setItem(DRAFT_KEY, JSON.stringify({ step: 1 }));
    expect(loadDraft(s)).toBeUndefined();
  });

  it("storage가 없거나 던져도 예외 없이 넘어간다", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveDraft(throwing, initialDraft())).not.toThrow();
    expect(loadDraft(throwing)).toBeUndefined();
    expect(() => clearDraft(throwing)).not.toThrow();
    expect(() => saveDraft(undefined, initialDraft())).not.toThrow();
    expect(loadDraft(undefined)).toBeUndefined();
  });
});
