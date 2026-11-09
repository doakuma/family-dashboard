// 명령의 대상 낱말 -> 위키 구성원. 이름·id(대소문자 무시)로 먼저 정확히 찾고, 없으면 이름에 들어 있는지 본다. 슬랙 멘션(@U…)은 슬랙 ID로.
import type { Member } from "@hsh/core";

export type MemberMatch = { type: "one"; member: Member } | { type: "many"; members: Member[] } | { type: "none" };

/** 끝에 붙은 주격·소유격 조사(하늘이, 엄마가, 아빠의). 한 글자 이름이 사라지지 않게 두 글자 이상일 때만 뗀다 */
const stripParticle = (s: string): string => (s.length > 2 && /[이가의]$/.test(s) ? s.slice(0, -1) : s);

export function findMembers(target: string, people: readonly Member[]): MemberMatch {
  const t = target.trim();
  if (!t) return { type: "none" };
  const mention = /^@(U[A-Z0-9]+)$/.exec(t);
  if (mention) {
    const hit = people.filter((m) => m.slackId === mention[1]);
    return hit.length === 1 && hit[0] ? { type: "one", member: hit[0] } : hit.length > 1 ? { type: "many", members: hit } : { type: "none" };
  }
  const queries = [...new Set([t, stripParticle(t)])].map((q) => q.toLowerCase());
  for (const q of queries) {
    const exact = people.filter((m) => m.name.toLowerCase() === q || m.id.toLowerCase() === q);
    if (exact.length === 1 && exact[0]) return { type: "one", member: exact[0] };
    if (exact.length > 1) return { type: "many", members: exact };
  }
  for (const q of queries) {
    if (q.length < 2) continue;
    const part = people.filter((m) => m.name.toLowerCase().includes(q));
    if (part.length === 1 && part[0]) return { type: "one", member: part[0] };
    if (part.length > 1) return { type: "many", members: part };
  }
  return { type: "none" };
}
