// 슬랙 연결 코드(#19): 세팅 마법사가 구성원마다 6자리 코드를 보여 주고, 본인이 슬랙에서 봇에게 `연결 482913`을 DM하면 슬랙 ID가 매핑된다.
// 마법사(대시보드)와 봇은 다른 프로세스라 프로세스 간 저장소가 필요하다 -> 포트 ConnectCodeStore (결정 0007).
// 이 파일은 브라우저에서도 쓰는 순수 부분만(타입·포트·코드 형식·메시지 파싱·코드 만들기). 파일 구현은 core/node의 FsConnectCodeStore.
import type { MemberRole } from "./types";

/** 코드 수명(발급부터). 마법사 한 번에 충분하고, 채널에 새도 오래 열려 있지 않게 */
export const CONNECT_CODE_TTL_MS = 30 * 60_000;
/** 연결이 끝난 코드가 마법사 완료 때까지 남아 있는 시간(claim부터). 폰을 오래 붙잡고 있어도 되게 넉넉히 */
export const CONNECT_CLAIM_TTL_MS = 24 * 60 * 60_000;
/** 한 범위에서 동시에 살아 있는 코드 상한(구성원 12명 + 여유). 발급 API 남용 방지 */
export const CONNECT_MAX_ACTIVE = 40;

/** 코드가 쓰이는 곳. 지금은 첫 세팅만. #22(/settings 재연결)는 값을 더해 쓴다 */
export type ConnectScope = "setup";

export const CONNECT_CODE_RE = /^\d{6}$/;
export const isConnectCode = (v: unknown): v is string => typeof v === "string" && CONNECT_CODE_RE.test(v);

export interface ConnectCodeRecord {
  code: string;
  /** 마법사 draft의 구성원 키(m1, m2…) - 위키 id와 다르다 */
  memberKey: string;
  /** 연결됐다고 알려 줄 때 보여 줄 이름 */
  name: string;
  role: MemberRole;
  scope: ConnectScope;
  /** ISO 시각 */
  issuedAt: string;
  expiresAt: string;
}

export type ClaimFailure =
  /** 없는 코드·만료·이미 다른 계정이 씀 - 구분해서 알려 주지 않는다(존재 여부를 흘리지 않음) */
  | { ok: false; reason: "invalid" }
  /** 이 슬랙 계정이 같은 세팅에서 이미 다른 구성원으로 연결됨 */
  | { ok: false; reason: "slack_taken"; name: string }
  /** 같은 계정이 같은 코드를 다시 보냄 */
  | { ok: false; reason: "already_yours"; name: string };
export type ClaimResult = { ok: true; record: ConnectCodeRecord } | ClaimFailure;

/** 연결된 코드 한 건(마법사 완료가 읽는다). slackId는 서버끼리만 주고받고 브라우저로 내보내지 않는다 */
export interface ClaimedCode {
  record: ConnectCodeRecord;
  slackId: string;
}

export type ConnectCodeState = "pending" | "connected" | "expired";

export class ConnectStoreError extends Error {
  constructor(
    message: string,
    readonly code: "too_many",
  ) {
    super(message);
    this.name = "ConnectStoreError";
  }
}

export interface IssueInput {
  memberKey: string;
  name: string;
  role: MemberRole;
  scope?: ConnectScope;
}

/**
 * 연결 코드 저장소. 발급(대시보드) · 사용 처리(봇) · 조회(대시보드)가 서로 다른 프로세스에서 일어난다.
 * 구현은 claim이 한 코드에 한 번만 성공하도록(두 프로세스·두 번 DM에도) 보장해야 한다.
 */
export interface ConnectCodeStore {
  /** 새 코드. 같은 범위·memberKey의 이전 코드(와 그 연결)는 무효가 된다. 활성 코드끼리 겹치지 않는다 */
  issue(input: IssueInput): Promise<ConnectCodeRecord>;
  /** 슬랙 DM으로 받은 코드를 쓴다. 한 번만 성공한다 */
  claim(code: string, slackId: string): Promise<ClaimResult>;
  /**
   * 코드를 못 쓰게 지운다(없어도 오류 아님). unclaimedOnly면 아직 연결 전인 코드만 지운다:
   * 채널에 새어 나간 코드를 무효화할 때, 이미 연결된 코드(과거에 본인이 쓴 것)는 건드리지 않게.
   */
  revoke(code: string, opts?: { unclaimedOnly?: boolean }): Promise<void>;
  /** 코드별 상태. 없는 코드는 expired로 답한다(존재 여부를 구분하지 않음). slackId는 주지 않는다 */
  states(codes: readonly string[]): Promise<Record<string, ConnectCodeState>>;
  /** 연결이 끝난 코드. 아직 연결 전이거나 없거나 만료면 undefined */
  claimed(code: string): Promise<ClaimedCode | undefined>;
  /** 한 범위의 코드를 전부 지운다(세팅 완료 뒤) */
  clearScope(scope: ConnectScope): Promise<void>;
}

/** 전각 숫자(０-９)를 반각으로 */
export function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 슬랙 글에서 `연결 482913`을 찾아 코드를 돌려준다. 공백(없어도, 여러 개·전각 공백도)·전각 숫자·콜론을 받는다.
 * 글 어디에 있어도 잡는다(채널에 "연결 482913 이거 맞아?"처럼 올려도 코드를 지워야 하므로). 숫자가 6자리보다 길면 코드가 아니다.
 */
export function parseConnectMessage(text: string): string | undefined {
  const m = /연결\s*[:：]?\s*(\d{6})(?!\d)/u.exec(toHalfWidthDigits(text).normalize("NFKC"));
  return m?.[1];
}

/**
 * 6자리 코드 하나. random은 [0, max) 정수를 돌려주는 함수(crypto.randomInt를 넣는다)이고, 쓰는 중인 코드(taken)와 겹치면 다시 뽑는다.
 * 뽑기를 계속 실패하면(거의 불가능) undefined.
 */
export function generateConnectCode(random: (max: number) => number, taken: ReadonlySet<string>, tries = 50): string | undefined {
  for (let i = 0; i < tries; i++) {
    const code = String(random(1_000_000)).padStart(6, "0");
    if (!taken.has(code)) return code;
  }
  return undefined;
}

/** 만료 판정(경계 포함: 만료 시각 정각부터 만료) */
export const isExpired = (expiresAt: string, now: Date): boolean => !(Date.parse(expiresAt) > now.getTime());
