import type { Member } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { findMembers } from "./resolve";

const m = (id: string, name: string, slackId?: string): Member => ({ id, name, role: "child", color: "blue", ...(slackId ? { slackId } : {}) });
const people = [m("mom", "엄마", "U0MOM"), m("haneul", "하늘"), m("dad", "아빠"), m("min1", "김민준"), m("min2", "박민준")];

describe("findMembers", () => {
  it("이름·id(대소문자 무시)로 정확히", () => {
    expect(findMembers("하늘", people)).toMatchObject({ type: "one", member: { id: "haneul" } });
    expect(findMembers("MOM", people)).toMatchObject({ type: "one", member: { id: "mom" } });
  });
  it("조사(이·가·의)를 떼고 찾는다", () => {
    expect(findMembers("하늘이", people)).toMatchObject({ type: "one", member: { id: "haneul" } });
    expect(findMembers("엄마의", people)).toMatchObject({ type: "one", member: { id: "mom" } });
  });
  it("조사가 붙은 이름 그대로인 구성원이 있으면 그쪽이 먼저", () => {
    expect(findMembers("하늘이", [m("a", "하늘이"), m("b", "하늘")])).toMatchObject({ type: "one", member: { id: "a" } });
  });
  it("이름 일부로 하나만 걸리면 그 구성원, 여럿이면 후보 전부", () => {
    expect(findMembers("김민", people)).toMatchObject({ type: "one", member: { id: "min1" } });
    const r = findMembers("민준", people);
    expect(r.type).toBe("many");
    expect(r.type === "many" && r.members.map((x) => x.name)).toEqual(["김민준", "박민준"]);
  });
  it("같은 이름이 둘이면 모호", () => {
    expect(findMembers("하늘", [m("a", "하늘"), m("b", "하늘")]).type).toBe("many");
  });
  it("한 글자는 부분 일치를 하지 않는다", () => {
    expect(findMembers("민", people).type).toBe("none");
  });
  it("슬랙 멘션은 슬랙 ID로", () => {
    expect(findMembers("@U0MOM", people)).toMatchObject({ type: "one", member: { id: "mom" } });
    expect(findMembers("@U0NOBODY", people).type).toBe("none");
  });
  it("없는 이름·빈 말은 none", () => {
    expect(findMembers("벽", people).type).toBe("none");
    expect(findMembers("  ", people).type).toBe("none");
  });
});
