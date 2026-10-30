// 마법사 입력 상태(draft)와 그것을 바꾸는 순수 함수. 화면(React)은 이 모듈만 거쳐서 상태를 바꾼다.
import { type MemberRole } from "@hsh/core";
import { z } from "zod";
import { suggestColor } from "./colors";
import { suggestMemberId } from "./member-id";

export const STEP_COUNT = 6;
export const MAX_MEMBERS = 12;
export const DEFAULT_TIMEZONE = "Asia/Seoul";

export interface MemberDraft {
  /** 화면 안에서만 쓰는 안정 키 (위키 id와 다르다) */
  key: string;
  name: string;
  role: MemberRole;
  /** YYYY-MM-DD 또는 빈 문자열 */
  birth: string;
  color: string;
  /** 위키 id. 이름에서 자동 생성되고 사용자가 고칠 수 있다 */
  id: string;
  /** 사용자가 id를 직접 고쳤는가 (true면 이름이 바뀌어도 id를 덮어쓰지 않는다) */
  idEdited: boolean;
}

export interface AnnivDraft {
  key: string;
  title: string;
  month: string;
  day: string;
  /** 구성원 id 또는 "family" */
  member: string;
}

export interface ManualRegionDraft {
  label: string;
  nx: string;
  ny: string;
  landId: string;
  taId: string;
}

export interface Draft {
  /** 1~6 */
  step: number;
  familyName: string;
  regionMode: "list" | "manual";
  regionKey: string;
  manual: ManualRegionDraft;
  timezone: string;
  members: MemberDraft[];
  anniversaries: AnnivDraft[];
  calendarId: string;
  /** 6단계: 이전 세팅 파일을 덮어쓰는 것을 확인했는가 */
  overwrite: boolean;
  /** 다음에 나눠 줄 key 번호 */
  nextKey: number;
}

export function newMember(d: Pick<Draft, "members" | "nextKey">, role: MemberRole = "guardian"): MemberDraft {
  return {
    key: `m${d.nextKey}`,
    name: "",
    role,
    birth: "",
    color: suggestColor(d.members.map((m) => m.color)),
    id: suggestMemberId("", d.members.map((m) => m.id)),
    idEdited: false,
  };
}

export function initialDraft(): Draft {
  const base = { members: [] as MemberDraft[], nextKey: 1 };
  const first = newMember(base);
  return {
    step: 1,
    familyName: "",
    regionMode: "list",
    regionKey: "",
    manual: { label: "", nx: "", ny: "", landId: "", taId: "" },
    timezone: DEFAULT_TIMEZONE,
    members: [first],
    anniversaries: [],
    calendarId: "",
    overwrite: false,
    nextKey: 2,
  };
}

export function addMember(d: Draft, role: MemberRole = "child"): Draft {
  if (d.members.length >= MAX_MEMBERS) return d;
  return { ...d, members: [...d.members, newMember(d, role)], nextKey: d.nextKey + 1 };
}

export function removeMember(d: Draft, key: string): Draft {
  if (d.members.length <= 1) return d;
  const removed = d.members.find((m) => m.key === key);
  const members = d.members.filter((m) => m.key !== key);
  // 지운 구성원을 가리키던 기념일은 가족 전체로
  const anniversaries = d.anniversaries.map((a) => (removed && a.member === removed.id ? { ...a, member: "family" } : a));
  return { ...d, members, anniversaries };
}

export function updateMember(d: Draft, key: string, patch: Partial<Omit<MemberDraft, "key" | "idEdited">>): Draft {
  const members = d.members.map((m) => {
    if (m.key !== key) return m;
    const next = { ...m, ...patch };
    if ("id" in patch) {
      // 비우면 다시 자동 생성으로
      const empty = (patch.id ?? "").trim() === "";
      next.idEdited = !empty;
      if (empty) next.id = suggestMemberId(next.name, d.members.filter((o) => o.key !== key).map((o) => o.id));
    } else if ("name" in patch && !m.idEdited) {
      next.id = suggestMemberId(next.name, d.members.filter((o) => o.key !== key).map((o) => o.id));
    }
    return next;
  });
  // id가 바뀌면 그 구성원을 가리키던 기념일도 따라간다
  const before = d.members.find((m) => m.key === key);
  const after = members.find((m) => m.key === key);
  const anniversaries = before && after && before.id !== after.id ? d.anniversaries.map((a) => (a.member === before.id ? { ...a, member: after.id } : a)) : d.anniversaries;
  return { ...d, members, anniversaries };
}

export function addAnniversary(d: Draft, init: Partial<AnnivDraft> = {}): Draft {
  return { ...d, anniversaries: [...d.anniversaries, { key: `a${d.nextKey}`, title: "", month: "", day: "", member: "family", ...init }], nextKey: d.nextKey + 1 };
}

export function removeAnniversary(d: Draft, key: string): Draft {
  return { ...d, anniversaries: d.anniversaries.filter((a) => a.key !== key) };
}

export function updateAnniversary(d: Draft, key: string, patch: Partial<Omit<AnnivDraft, "key">>): Draft {
  return { ...d, anniversaries: d.anniversaries.map((a) => (a.key === key ? { ...a, ...patch } : a)) };
}

// ---------- 새로고침 대비 저장 (sessionStorage) ----------
// 판단: 단계 간 입력은 클라이언트 상태(React) + sessionStorage에 둔다. 서버 세션 메모리에 두지 않는 이유는 결정 기록 0003.
// 저장 값에는 PIN·토큰이 없다. 탭을 닫으면 사라지고, 완료하면 지운다.

export const DRAFT_KEY = "hsh.setup.draft.v1";

const str = (max: number) => z.string().max(max);
const draftSchema = z.object({
  step: z.number().int().min(1).max(STEP_COUNT),
  familyName: str(200),
  regionMode: z.enum(["list", "manual"]),
  regionKey: str(60),
  manual: z.object({ label: str(200), nx: str(10), ny: str(10), landId: str(20), taId: str(20) }),
  timezone: str(60),
  members: z
    .array(z.object({ key: str(10), name: str(200), role: z.enum(["guardian", "child"]), birth: str(10), color: str(30), id: str(60), idEdited: z.boolean() }))
    .min(1)
    .max(MAX_MEMBERS),
  anniversaries: z.array(z.object({ key: str(10), title: str(200), month: str(2), day: str(2), member: str(60) })).max(60),
  calendarId: str(300),
  overwrite: z.boolean(),
  nextKey: z.number().int().min(1).max(100000),
}) satisfies z.ZodType<Draft>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 저장 실패(사생활 보호 모드, 용량)는 조용히 넘어간다: 새로고침 대비일 뿐 필수 기능이 아니다. */
export function saveDraft(storage: StorageLike | undefined, d: Draft): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* 저장 안 됨 */
  }
}

export function loadDraft(storage: StorageLike | undefined): Draft | undefined {
  try {
    const raw = storage?.getItem(DRAFT_KEY);
    if (!raw) return undefined;
    const r = draftSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

export function clearDraft(storage: StorageLike | undefined): void {
  try {
    storage?.removeItem(DRAFT_KEY);
  } catch {
    /* 무시 */
  }
}
