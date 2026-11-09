// 설정 변경(색 바꾸기) 확인을 기다리는 요청 보관소. flow/pending.ts와 같은 규칙: 버튼 값에는 요청 id만, 상태 전이로 두 번 눌러도 한 번만, 24시간 뒤 만료, 메모리 보관(봇을 다시 켜면 사라짐).
// LLM의 Change를 담는 flow/PendingStore와 따로 둔다: 담는 것이 SettingsChange이고, 확인 문장·상태가 더 단순하다.
import type { FamilyId, MemberId } from "@hsh/core";
import { PENDING_TTL_MS } from "../flow/pending";
import type { MessageRef, Thread } from "../flow/ui";

/** 흐름의 PendingStore id("p…")와 겹치지 않는 머리말. 버튼이 눌렸을 때 어느 쪽 요청인지 가리는 데 쓴다 */
export const SETTINGS_ID_PREFIX = "s_";
export const isSettingsPendingId = (id: string): boolean => id.startsWith(SETTINGS_ID_PREFIX);

/** confirm → applying → done | failed(→ applying) ; confirm|failed → cancelled */
export type SettingsPendingStatus = "confirm" | "applying" | "failed" | "done" | "cancelled";

export interface SettingsPending {
  id: string;
  familyId: FamilyId;
  /** 요청한 사람(슬랙 사용자 id). 버튼은 이 사람만 누를 수 있다 */
  userId: string;
  thread: Thread;
  memberId: MemberId;
  /** 확인 문장에 쓰는 이름(요청 시점) */
  memberName: string;
  /** 바꿀 색 이름 */
  color: string;
  status: SettingsPendingStatus;
  card?: MessageRef;
  touchedAt: number;
  lastError?: string;
}

const MAX_PENDING = 200;

export class SettingsPendingStore {
  private readonly items = new Map<string, SettingsPending>();
  private seq = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = PENDING_TTL_MS,
  ) {}

  create(p: Omit<SettingsPending, "id" | "touchedAt">): SettingsPending {
    this.prune();
    const id = `${SETTINGS_ID_PREFIX}${this.now().toString(36)}${(++this.seq).toString(36)}`;
    const item: SettingsPending = { ...p, id, touchedAt: this.now() };
    this.items.set(id, item);
    return item;
  }

  get(id: string): SettingsPending | undefined {
    const p = this.items.get(id);
    if (!p) return undefined;
    if (this.expired(p)) {
      this.items.delete(id);
      return undefined;
    }
    return p;
  }

  /** from 상태 중 하나일 때만 to로 바꾼다. 검사와 변경 사이에 await가 없어 한 프로세스 안에서 원자적이다 */
  transition(p: SettingsPending, from: readonly SettingsPendingStatus[], to: SettingsPendingStatus): boolean {
    if (!from.includes(p.status)) return false;
    p.status = to;
    p.touchedAt = this.now();
    return true;
  }

  private expired(p: SettingsPending): boolean {
    return p.status !== "applying" && this.now() - p.touchedAt > this.ttlMs;
  }

  private prune(): void {
    for (const [id, p] of this.items) if (this.expired(p)) this.items.delete(id);
    while (this.items.size >= MAX_PENDING) {
      const oldest = [...this.items.values()].find((p) => p.status !== "applying");
      if (!oldest) break;
      this.items.delete(oldest.id);
    }
  }
}
