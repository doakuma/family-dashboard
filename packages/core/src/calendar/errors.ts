// 구글 캘린더 복사 오류. 메시지는 우리가 만든 고정 문구뿐이다: 서비스 계정 키·토큰·캘린더 id·URL은 어디에도 싣지 않는다(로그·슬랙으로 나갈 수 있음).

export type CalendarErrorKind =
  /** 키·토큰 문제(401, invalid_grant 등) */
  | "auth"
  /** 이 캘린더에 쓸 권한 없음(서비스 계정에 공유 안 함 등) */
  | "forbidden"
  | "not_found"
  /** 같은 id가 이미 있음(409) */
  | "conflict"
  | "rate_limit"
  /** 구글 5xx */
  | "server"
  /** 그 밖의 HTTP 오류(400 등, 다시 해도 같음) */
  | "http"
  | "network"
  | "timeout"
  /** 우리 쪽 설정 문제(캘린더 id 없음, 키 파일 형식 등) */
  | "config";

/** 같은 요청을 다시 보내면 나을 수 있는 종류 */
export const RETRYABLE_KINDS: readonly CalendarErrorKind[] = ["rate_limit", "server", "network", "timeout"];
/** 이 종류면 같은 실행의 나머지 일도 실패할 것이므로 멈춘다 */
export const ABORT_KINDS: readonly CalendarErrorKind[] = ["auth", "forbidden", "config", "rate_limit"];

export class CalendarSyncError extends Error {
  constructor(
    readonly kind: CalendarErrorKind,
    message: string,
    /** HTTP 상태(있을 때) */
    readonly status?: number,
    /** 구글이 준 오류 이유 코드(영문자만, 예: rateLimitExceeded). 값이 이상하면 버린다 */
    readonly reason?: string,
    /** Retry-After(ms) */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CalendarSyncError";
  }
  get retryable(): boolean {
    return RETRYABLE_KINDS.includes(this.kind);
  }
}
