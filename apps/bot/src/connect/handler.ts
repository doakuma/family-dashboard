// 슬랙 연결 코드 처리기(#19). 슬랙과 무관하다: 저장소와 응답 창구를 포트로 받는다(대화 흐름 ConversationUi의 post·whisper를 그대로 쓴다).
// 규칙: DM에서만 연결한다. 채널에 올라온 코드는 처리하지 않고 지운다. 틀림·만료·이미 사용은 같은 문구로(존재 여부를 흘리지 않는다).
// 슬랙 사용자별로 연속 실패 5회면 15분 잠근다(메모리).
import { parseConnectMessage, type ConnectCodeStore, type ConnectScope } from "@hsh/core";
import { textCard, type ConversationMessage, type ConversationUi } from "../flow/ui";

/** 안내 문구가 가리킬 화면: 세팅 마법사(setup) / 설정(settings) */
const screenOf = (scope: ConnectScope) => (scope === "settings" ? "설정" : "세팅");

export const CONNECT_TEXT = {
  /** 틀림·만료·이미 사용 모두 이 문구 하나 */
  invalid: "코드가 맞지 않거나 시간이 지났어요. 세팅 화면에서 새 코드를 받아 다시 보내 주세요.",
  channel: "코드는 봇 DM으로 보내 주세요. 채널에 보인 코드는 지웠으니 새 코드를 받아 주세요.",
  locked: "연결 시도가 너무 많았어요. 15분 뒤에 다시 보내 주세요.",
  failed: "지금은 연결하지 못했어요. 잠시 뒤에 다시 보내 주세요.",
  connected: (name: string) => `'${name}'(으)로 연결했어요. 세팅을 마치면 이 슬랙 계정으로 쓸 수 있어요.`,
  /** 세팅 뒤 /settings에서 받은 코드(범위 settings): 화면에서 '연결 반영'을 눌러야 위키에 저장된다 */
  connectedSettings: (name: string) => `'${name}'(으)로 확인했어요. 설정 화면에서 '연결 반영'을 눌러야 저장돼요.`,
  alreadyYours: (name: string, scope: ConnectScope = "setup") => `이미 '${name}'(으)로 연결돼 있어요. ${screenOf(scope)} 화면에서 '연결됨'을 확인해 주세요.`,
  slackTaken: (name: string, scope: ConnectScope = "setup") => `이 슬랙 계정은 이미 '${name}'(으)로 연결돼 있어요. 한 계정은 한 구성원에만 연결할 수 있어요. 잘못 연결했다면 ${screenOf(scope)} 화면에서 '${name}' 구성원의 코드를 다시 받으면 풀려요.`,
} as const;

const assertNever = (x: never): never => {
  throw new Error(`처리하지 않은 연결 결과: ${JSON.stringify(x)}`);
};

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;

/** 슬랙 사용자별 실패 횟수와 잠금. 실패는 첫 실패부터 15분 안에 쌓인 것만 센다 */
export class AttemptLimiter {
  private readonly users = new Map<string, { failures: number; since: number; lockedUntil?: number }>();
  constructor(
    private readonly now: () => number,
    private readonly max = MAX_FAILURES,
    private readonly lockMs = LOCK_MS,
  ) {}

  /** 잠겨 있으면 남은 ms, 아니면 0 */
  lockedFor(userId: string): number {
    const e = this.users.get(userId);
    if (!e?.lockedUntil) return 0;
    const left = e.lockedUntil - this.now();
    if (left > 0) return left;
    this.users.delete(userId);
    return 0;
  }

  fail(userId: string): void {
    const t = this.now();
    const e = this.users.get(userId);
    const cur = e && !e.lockedUntil && t - e.since < this.lockMs ? e : { failures: 0, since: t };
    cur.failures += 1;
    if (cur.failures >= this.max) cur.lockedUntil = t + this.lockMs;
    this.users.set(userId, cur);
    if (this.users.size > 1000) this.prune(t);
  }

  succeed(userId: string): void {
    this.users.delete(userId);
  }

  private prune(t: number) {
    for (const [id, e] of this.users) if ((e.lockedUntil ?? e.since + this.lockMs) <= t) this.users.delete(id);
  }
}

export interface ConnectHandlerDeps {
  store: Pick<ConnectCodeStore, "claim" | "revoke">;
  ui: Pick<ConversationUi, "post" | "whisper">;
  now?: () => number;
  limiter?: AttemptLimiter;
  log?: (message: string) => void;
}

export class ConnectHandler {
  private readonly limiter: AttemptLimiter;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: ConnectHandlerDeps) {
    this.limiter = deps.limiter ?? new AttemptLimiter(deps.now ?? Date.now);
    this.log = deps.log ?? ((m) => console.error(`[bot] ${m}`));
  }

  /**
   * `연결 <6자리>` 글이면 처리하고 true(대화 흐름으로 넘기지 않는다). 아니면 false. 던지지 않는다.
   * 코드는 글에 있어도 로그에 남기지 않는다.
   */
  async tryHandle(msg: ConversationMessage): Promise<boolean> {
    const code = parseConnectMessage(msg.text);
    if (!code) return false;
    const { thread, userId } = msg;
    try {
      if (!thread.isDirect) {
        // 채널에 올라온 코드는 이미 여러 사람이 본다: 처리하지 않고 지운다. 보낸 사람에게만 알린다
        // 아직 연결 전인 코드만 지운다: 이미 연결된 코드를 채널에 다시 올려도 기존 연결은 그대로
        await this.deps.store.revoke(code, { unclaimedOnly: true });
        await this.deps.ui.whisper(thread, userId, CONNECT_TEXT.channel);
        return true;
      }
      const locked = this.limiter.lockedFor(userId);
      if (locked > 0) {
        await this.reply(msg, CONNECT_TEXT.locked);
        return true;
      }
      const r = await this.deps.store.claim(code, userId);
      if (r.ok) {
        this.limiter.succeed(userId);
        await this.reply(msg, r.record.scope === "settings" ? CONNECT_TEXT.connectedSettings(r.record.name) : CONNECT_TEXT.connected(r.record.name));
        return true;
      }
      switch (r.reason) {
        case "slack_taken":
          await this.reply(msg, CONNECT_TEXT.slackTaken(r.name, r.scope));
          break;
        case "already_yours":
          await this.reply(msg, CONNECT_TEXT.alreadyYours(r.name, r.scope));
          break;
        case "invalid":
          this.limiter.fail(userId);
          await this.reply(msg, this.limiter.lockedFor(userId) > 0 ? CONNECT_TEXT.locked : CONNECT_TEXT.invalid);
          break;
        default:
          return assertNever(r);
      }
    } catch (e) {
      this.log(`연결 코드 처리 실패: ${e instanceof Error ? e.message : String(e)}`);
      await this.reply(msg, CONNECT_TEXT.failed).catch(() => {});
    }
    return true;
  }

  private async reply(msg: ConversationMessage, text: string): Promise<void> {
    await this.deps.ui.post(msg.thread, textCard(text));
  }
}
