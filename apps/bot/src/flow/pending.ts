// 확인 버튼을 기다리는 요청 보관소. 버튼에는 id만 싣고, 실제 변경(Change)은 서버 메모리에 둔다.
// (버튼 값은 메신저를 거쳐 오므로 변경 내용을 싣지 않는다. 같은 버튼을 두 번 눌러도 상태 전이로 한 번만 처리한다.)
// MVP는 메모리 보관이라 봇을 다시 켜면 기다리던 요청은 사라진다 → 그 버튼은 "시간이 지났어요"로 답한다.
import type { Change, Event, FamilyId } from "@hsh/core";
import type { MessageRef, Thread } from "./ui";

/**
 * 상태 전이: confirm|choose → applying → done | failed(→ applying 다시 시도)
 *            confirm|choose|failed → cancelled, confirm → editing → replaced
 */
export type PendingStatus = "choose" | "confirm" | "applying" | "failed" | "done" | "cancelled" | "editing" | "replaced";

export interface Pending {
  id: string;
  familyId: FamilyId;
  /** 요청한 사람(메신저 사용자 id). 버튼은 이 사람만 누를 수 있다 */
  userId: string;
  thread: Thread;
  /** 사용자가 처음 보낸 글(고치기 때 함께 LLM에 다시 보낸다) */
  text: string;
  status: PendingStatus;
  /** confirm 이후: 넣을 변경들. 앞에서부터 차례로 넣고, 넣은 만큼 applied가 늘어난다(다시 시도는 남은 것부터) */
  changes: Change[];
  applied: number;
  preview: string;
  /** choose: 고를 후보 */
  choice?: ChoiceState;
  /** 버튼이 달린 메시지(상태가 바뀌면 이 메시지를 고친다) */
  card?: MessageRef;
  createdAt: number;
  lastError?: string;
}

export interface ChoiceState {
  kind: "event.update" | "event.remove" | "task.done";
  candidates: string[];
  patch?: Partial<Event>;
}

/** 버튼을 누를 수 있는 시간. 지나면 "시간이 지났어요" */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** 메모리 상한. 넘으면 오래된 것부터 버린다 */
const MAX_PENDING = 500;

export class PendingStore {
  private readonly items = new Map<string, Pending>();
  private seq = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = PENDING_TTL_MS,
  ) {}

  create(p: Omit<Pending, "id" | "createdAt" | "applied">): Pending {
    this.prune();
    const id = `p${this.now().toString(36)}${(++this.seq).toString(36)}`;
    const item: Pending = { ...p, id, applied: 0, createdAt: this.now() };
    this.items.set(id, item);
    return item;
  }

  /** 없거나 시간이 지났으면 undefined */
  get(id: string): Pending | undefined {
    const p = this.items.get(id);
    if (!p) return undefined;
    if (this.expired(p)) {
      this.items.delete(id);
      return undefined;
    }
    return p;
  }

  /** 이 스레드에서 이 사람이 고치는 중인 요청 */
  findEditing(userId: string, thread: Thread): Pending | undefined {
    for (const p of this.items.values()) {
      if (p.status === "editing" && p.userId === userId && p.thread.channelId === thread.channelId && p.thread.threadId === thread.threadId && !this.expired(p)) return p;
    }
    return undefined;
  }

  /**
   * from 상태 중 하나일 때만 to로 바꾼다(같은 버튼을 두 번 눌러도 한 번만 통과). 바꿨으면 true.
   * 검사와 변경 사이에 await가 없으므로 한 프로세스 안에서 원자적이다.
   */
  transition(p: Pending, from: readonly PendingStatus[], to: PendingStatus): boolean {
    if (!from.includes(p.status)) return false;
    p.status = to;
    return true;
  }

  get size(): number {
    return this.items.size;
  }

  private expired(p: Pending): boolean {
    // 넣는 중인 요청은 시간이 지나도 끝날 때까지 둔다
    return p.status !== "applying" && this.now() - p.createdAt > this.ttlMs;
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
