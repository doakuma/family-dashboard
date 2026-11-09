import { describe, expect, it } from "vitest";
import { canWrite, permissionFor } from "./permission";

const members = [
  { role: "guardian", slackId: "U1" },
  { role: "child", slackId: "U2" },
  { role: "child" },
  { role: "guardian", slackId: "U4" },
  { role: "child", slackId: "U4" },
] as const;

describe("permissionFor", () => {
  it("등록된 보호자·아이를 구분한다", () => {
    expect(permissionFor(members, "U1")).toBe("guardian");
    expect(permissionFor(members, "U2")).toBe("child");
  });
  it("등록되지 않았거나 빈 id는 unregistered", () => {
    expect(permissionFor(members, "U9")).toBe("unregistered");
    expect(permissionFor(members, "")).toBe("unregistered");
    expect(permissionFor([], "U1")).toBe("unregistered");
  });
  it("role이 누락되거나 틀린 값이면 child", () => {
    const bad = [{ slackId: "U5" }, { role: "admin", slackId: "U6" }, { role: "Guardian", slackId: "U7" }] as unknown as { role: "guardian"; slackId: string }[];
    expect(permissionFor(bad, "U5")).toBe("child");
    expect(permissionFor(bad, "U6")).toBe("child");
    expect(permissionFor(bad, "U7")).toBe("child");
  });
  it("같은 slackId가 여럿이면 가장 좁은 쪽", () => {
    expect(permissionFor(members, "U4")).toBe("child");
  });
});

describe("canWrite", () => {
  it("보호자만 쓸 수 있다", () => {
    expect(canWrite("guardian")).toBe(true);
    expect(canWrite("child")).toBe(false);
    expect(canWrite("unregistered")).toBe(false);
  });
});
