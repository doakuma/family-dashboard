// 세팅 완료 알림 처리기(#20, 결정 0008): 대시보드가 상자(SetupNoticeStore)에 넣은 알림을 주기적으로 꺼내 #가족 채널에 환영 메시지를 한 번만 올린다.
// 중복 방지: claim(배타) 뒤에만 게시하고 게시 직후 complete. 실패하면 release하고 간격을 늘려 다시 시도한다.
// 24시간이 지난 알림은 게시하지 않고 정리한다. 채널 설정이 없으면 알림을 남겨 두고(설정 후 재시작하면 게시) 경고만 한다.
import { SETUP_NOTICE_TTL_MS, type SetupNotice, type FamilyId, type SetupNoticeStore, type WikiState } from "@hsh/core";
import { buildWelcomeMessage } from "./message";

export type WelcomePoster = (channel: string, text: string) => Promise<void>;

export interface WelcomeWorkerDeps {
  store: SetupNoticeStore;
  /** 위키를 읽는다(구성원·가족 이름) */
  readState: (familyId: FamilyId) => Promise<WikiState>;
  post: WelcomePoster;
  /** SLACK_FAMILY_CHANNEL. 없으면 게시하지 않고 알림을 남긴다 */
  channel?: string;
  now?: () => number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  /** 확인 주기 */
  intervalMs?: number;
  /** 실패 뒤 첫 재시도 간격과 상한(두 배씩 늘린다) */
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export const WELCOME_POLL_MS = 5_000;
export const WELCOME_RETRY_BASE_MS = 5_000;
export const WELCOME_RETRY_MAX_MS = 10 * 60_000;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class WelcomeWorker {
  private readonly now: () => number;
  private readonly log: (m: string) => void;
  private readonly warn: (m: string) => void;
  private readonly retry = new Map<string, { failures: number; nextAt: number }>();
  /** 게시는 했는데 complete를 못 한 알림(다시 게시하지 않고 complete만 재시도) */
  private readonly posted = new Set<string>();
  private warnedNoChannel = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(private readonly deps: WelcomeWorkerDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((m) => console.log(`[welcome] ${m}`));
    this.warn = deps.warn ?? ((m) => console.warn(`[welcome] ${m}`));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const loop = async () => {
      await this.tick();
      if (!this.stopped) {
        this.timer = setTimeout(() => void loop(), this.deps.intervalMs ?? WELCOME_POLL_MS);
        this.timer.unref?.();
      }
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 한 번 확인한다. 겹쳐 돌지 않고, 던지지 않는다(봇이 죽지 않게) */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (e) {
      this.warn(`확인하지 못했어요: ${msg(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const { store, channel } = this.deps;
    for (const id of await store.expire()) {
      this.retry.delete(id);
      this.posted.delete(id);
      this.log(`24시간이 지난 세팅 완료 알림을 게시하지 않고 지웠어요 (${id.slice(0, 8)})`);
    }
    const notices = await store.list();
    if (notices.length === 0) return;
    if (!channel) {
      if (!this.warnedNoChannel) this.warn("SLACK_FAMILY_CHANNEL이 없어 환영 메시지를 올리지 못했어요. 채널 id를 설정하고 봇을 다시 시작하면 올려요(24시간 안).");
      this.warnedNoChannel = true;
      return;
    }
    for (const notice of notices) await this.handle(notice, channel);
  }

  private async handle(notice: SetupNotice, channel: string): Promise<void> {
    const { store } = this.deps;
    const at = Date.parse(notice.completedAt);
    // 만료는 expire가 지우지만, 그 직후 시각 경계에서도 오래된 환영 메시지는 올리지 않는다
    if (!Number.isFinite(at) || this.now() - at >= SETUP_NOTICE_TTL_MS) return;
    if (this.posted.has(notice.id)) {
      await this.finish(notice.id);
      return;
    }
    const r = this.retry.get(notice.id);
    if (r && this.now() < r.nextAt) return;
    if (!(await store.claim(notice.id))) return; // 다른 봇이 처리 중이거나 이미 끝남
    try {
      const state = await this.deps.readState(notice.familyId);
      if (!state.config) throw new Error("위키에서 가족 설정을 읽지 못했어요");
      await this.deps.post(channel, buildWelcomeMessage({ familyName: state.config.familyName, members: state.members }));
    } catch (e) {
      const failures = (r?.failures ?? 0) + 1;
      const wait = Math.min((this.deps.retryBaseMs ?? WELCOME_RETRY_BASE_MS) * 2 ** (failures - 1), this.deps.retryMaxMs ?? WELCOME_RETRY_MAX_MS);
      this.retry.set(notice.id, { failures, nextAt: this.now() + wait });
      this.warn(`환영 메시지 게시 실패(${failures}번째, ${Math.round(wait / 1000)}초 뒤 다시): ${msg(e)}`);
      await store.release(notice.id);
      return;
    }
    this.posted.add(notice.id);
    this.retry.delete(notice.id);
    this.log(`환영 메시지를 올렸어요 (${notice.id.slice(0, 8)})`);
    await this.finish(notice.id);
  }

  private async finish(id: string): Promise<void> {
    try {
      await this.deps.store.complete(id);
      this.posted.delete(id);
    } catch (e) {
      this.warn(`게시는 했지만 완료 표시를 못 했어요(다시 올리지 않고 표시만 다시 시도): ${msg(e)}`);
    }
  }
}
