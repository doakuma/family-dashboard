// 구성원 id 자동 생성. 위키 파일 이름(members/<id>.md)과 일정의 `@id` 토큰에 쓰인다 (memberIdSchema: ^[A-Za-z0-9_-]+$).
// 판단: 한글 이름을 로마자로 바꾸는 규칙은 넣지 않는다(이름마다 표기가 달라 틀린 id를 만들기 쉽다).
//   영문 이름이면 소문자 slug를 쓰고, 한글(영문 slug가 2자 미만)이면 member-1, member-2 … 를 쓴다. 사용자가 id를 직접 고칠 수도 있다.
const MAX_LEN = 24;

/** 영문·숫자만 남긴 소문자 slug. 영문이 없으면 빈 문자열 */
export function latinSlug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN)
    .replace(/-+$/, "");
}

/** taken(대소문자 무시)과 겹치지 않는 id. 'family'는 예약이라 항상 피한다. */
export function suggestMemberId(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  used.add("family");
  const slug = latinSlug(name);
  if (slug.length >= 2) {
    if (!used.has(slug)) return slug;
    for (let n = 2; ; n++) {
      const cand = `${slug}-${n}`;
      if (!used.has(cand)) return cand;
    }
  }
  for (let n = 1; ; n++) {
    const cand = `member-${n}`;
    if (!used.has(cand)) return cand;
  }
}
