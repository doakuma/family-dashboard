import type { Member, MemberId } from "@hsh/core";
import { colorOf } from "@/lib/palette";
import s from "./MemberDot.module.css";

export type MemberMap = ReadonlyMap<MemberId, Member>;

export function toMemberMap(members: Member[]): MemberMap {
  return new Map(members.map((m) => [m.id, m]));
}

/** 구성원 색 점. 이름은 화면 읽기 프로그램용으로만 남긴다. */
export function MemberDots({ ids, members, size = "md" }: { ids: MemberId[]; members: MemberMap; size?: "sm" | "md" }) {
  const list = ids.map((id) => members.get(id)).filter((m): m is Member => !!m);
  if (!list.length) return null;
  return (
    <span className={s.dots} data-size={size}>
      {list.map((m) => (
        <span key={m.id} className={s.dot} style={{ background: colorOf(m.color) }} aria-hidden />
      ))}
      <span className="sr-only">{list.map((m) => m.name).join(", ")}</span>
    </span>
  );
}
