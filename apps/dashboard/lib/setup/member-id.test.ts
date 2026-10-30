import { memberIdSchema } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { latinSlug, suggestMemberId } from "./member-id";

describe("suggestMemberId", () => {
  it("영문 이름은 소문자 slug", () => {
    expect(suggestMemberId("Haneul", [])).toBe("haneul");
    expect(suggestMemberId("Mary Jane", [])).toBe("mary-jane");
    expect(suggestMemberId("José", [])).toBe("jose");
  });
  it("한글 이름은 member-N (로마자 변환 없음), 비어 있는 가장 작은 번호", () => {
    expect(suggestMemberId("하늘", [])).toBe("member-1");
    expect(suggestMemberId("하늘", ["member-1"])).toBe("member-2");
    expect(suggestMemberId("", ["member-1", "member-3"])).toBe("member-2");
  });
  it("영문이 1글자뿐인 섞인 이름도 member-N (엉뚱한 id 방지)", () => {
    expect(suggestMemberId("민수2", [])).toBe("member-1");
    expect(suggestMemberId("A", [])).toBe("member-1");
    expect(suggestMemberId("하늘 Jr", [])).toBe("jr");
  });
  it("충돌하면 -2, -3 (대소문자 무시)", () => {
    expect(suggestMemberId("Mom", ["mom"])).toBe("mom-2");
    expect(suggestMemberId("Mom", ["MOM", "mom-2"])).toBe("mom-3");
  });
  it("예약 id family는 피한다", () => {
    expect(suggestMemberId("Family", [])).toBe("family-2");
    expect(suggestMemberId("family", [])).toBe("family-2");
  });
  it("결과는 항상 memberIdSchema를 통과하고 family가 아니다", () => {
    for (const n of ["", "하늘", "!!", "A b C", "x".repeat(100), "엄마 Mom", "😀", "Ünïcode", "family"]) {
      const id = suggestMemberId(n, []);
      expect(memberIdSchema.safeParse(id).success, n).toBe(true);
      expect(id).not.toBe("family");
      expect(id.length).toBeLessThanOrEqual(26);
    }
  });
  it("latinSlug: 긴 이름은 24자로 자르고 끝의 -를 정리", () => {
    expect(latinSlug("a".repeat(30))).toHaveLength(24);
    expect(latinSlug("abc!!")).toBe("abc");
  });
});
