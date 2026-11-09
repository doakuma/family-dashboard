// 구성원 권한 판정(순수 함수). 메신저와 무관하다.
// 스펙: 구성원 파일에 등록된 슬랙 사용자만 쓰기 가능, role은 guardian만 쓰기, child는 질문만.
// 파서(wiki/format.ts)는 role이 없거나 틀리면 child로 읽는다. 여기서도 같은 방향(좁은 쪽)으로 읽는다.
import type { Member } from "./types";

export type Permission = "guardian" | "child" | "unregistered";

/** 슬랙 사용자 id -> 권한. 같은 id가 여러 구성원이면 가장 좁은 쪽(child)을 쓴다. */
export function permissionFor(members: readonly Pick<Member, "role" | "slackId">[], slackId: string): Permission {
  const id = slackId.trim();
  if (!id) return "unregistered";
  const mine = members.filter((m) => m.slackId?.trim() === id);
  if (mine.length === 0) return "unregistered";
  // guardian이라고 정확히 적힌 경우만 보호자. 그 밖(누락·오타)은 child
  return mine.every((m) => m.role === "guardian") ? "guardian" : "child";
}

/** 위키에 쓰는 요청을 해도 되는가(보호자만) */
export function canWrite(permission: Permission): boolean {
  return permission === "guardian";
}
