import { describe, expect, it } from "vitest";
import { buildWelcomeMessage, welcomeExamples } from "./message";

const members = [
  { id: "mom", name: "엄마", role: "guardian" as const, slackId: "U111AB" },
  { id: "sky", name: "하늘", role: "child" as const },
  { id: "dad", name: "아빠", role: "guardian" as const, slackId: "U222CD" },
  { id: "family", name: "가족", role: "guardian" as const },
];
const examples = (t: string) => t.split("\n").filter((l) => /^\d\. /.test(l));

describe("buildWelcomeMessage", () => {
  it("가족 이름 환영 + 슬랙 연결된 사람만 멘션 + 예시 정확히 3개 + 확인 안내", () => {
    const t = buildWelcomeMessage({ familyName: "햇살네", members });
    expect(t).toContain("*햇살네*");
    expect(t).toContain("<@U111AB> <@U222CD>");
    expect(t).not.toContain("하늘>"); // 슬랙 ID 없는 아이는 멘션 없음
    expect(t).not.toContain("<@undefined>");
    expect(examples(t)).toHaveLength(3);
    expect(t).toContain("확인하면 위키에 들어가요");
  });

  it("예시는 일정 넣기·장보기 추가·질문 순이고 실제 구성원 이름을 쓴다(일정은 아이, 질문은 보호자)", () => {
    const [a, b, c] = welcomeExamples(members);
    expect(a).toBe("다음 주 화요일 3시 하늘 치과");
    expect(b).toContain("장보기");
    expect(c).toBe("이번 주말에 엄마 일정 뭐 있어?");
  });

  it("구성원이 없거나 '가족'뿐이면 이름 없는 예시, 멘션 줄 없음", () => {
    for (const ms of [[], [members[3]!]]) {
      const t = buildWelcomeMessage({ familyName: "햇살네", members: ms });
      expect(examples(t)).toHaveLength(3);
      expect(t).not.toContain("함께 써요");
      expect(welcomeExamples(ms)).toEqual(["다음 주 화요일 3시 치과", "장보기에 우유랑 계란 추가해 줘", "이번 주말에 일정 뭐 있어?"]);
    }
  });

  it("이름의 특수 문자는 이스케이프하고 코드 표시·줄바꿈은 걷어 낸다. 이상한 slackId는 멘션하지 않는다", () => {
    const t = buildWelcomeMessage({
      familyName: "<!channel> & 네",
      members: [{ id: "x", name: "a`b\nc<@U999>", role: "child", slackId: "U1>|x" }, { id: "y", name: "y", role: "guardian", slackId: "lower" }],
    });
    expect(t).toContain("&lt;!channel&gt; &amp; 네");
    expect(t).not.toContain("<!channel>");
    expect(t).not.toContain("<@U999>");
    expect(t).not.toMatch(/<@U1|<@lower/);
    expect(examples(t)).toHaveLength(3);
    expect(t.split("\n").filter((l) => l.includes("`")).every((l) => (l.match(/`/g) ?? []).length === 2)).toBe(true);
  });

  it("가족 이름의 서식 기호(* _ ~ `)는 굵게를 깨지 않도록 뺀다", () => {
    const t = buildWelcomeMessage({ familyName: "*해_ㅅ~살`네*", members: [] });
    expect(t.split("\n")[0]).toContain("*해ㅅ살 네*");
  });

  it("멘션은 12명까지", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, name: `n${i}`, role: "guardian" as const, slackId: `U${String(100 + i)}` }));
    expect((buildWelcomeMessage({ familyName: "큰집", members: many }).match(/<@U/g) ?? []).length).toBe(12);
  });
});
