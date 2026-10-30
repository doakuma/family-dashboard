// 어댑터 인터페이스 — 위젯은 타입만 알고, 입력·저장·외부 서비스는 이 뒤에 숨긴다.
import type { Change, Event, IncomingMessage, SetupInput, WeatherDay, WikiState } from "./types";

/** 저장소: 위키 파일 ↔ 도메인 타입 */
export interface WikiRepository {
  read(): Promise<WikiState>;
  /** 파일 수정 + commit + push. push가 실패해도 커밋은 남고 pushed:false(+원인 pushError)로 알린다. */
  apply(change: Change): Promise<{ commit: string; pushed: boolean; pushError?: string }>;
  /**
   * 첫 세팅(/setup 마법사) 전용. config.md + members/*.md + anniversaries.md(+ log.md)를 쓰기 큐 안에서 커밋 하나로 쓴다.
   * `Change`가 아니라 LLM·봇 경로에서는 부를 수 없는 내부 메서드다. 세팅이 필요한 위키(needsSetup)에서만 쓸 수 있다.
   * 실패하면 파일을 원래대로 되돌린다. 거부 사유는 `SetupError`(already_done·needs_confirm·invalid·read_only).
   */
  applySetup(setup: SetupInput, opts?: { overwrite?: boolean }): Promise<{ commit: string; pushed: boolean; pushError?: string }>;
}

/** 메신저: 슬랙 1차, 이후 추가 */
export interface MessengerAdapter {
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
  confirm(msg: IncomingMessage, preview: string, change: Change): Promise<void>;
  reply(msg: IncomingMessage, text: string): Promise<void>;
}

/** 외부 서비스 */
export interface CalendarSync {
  upsert(e: Event): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface WeatherSource {
  week(): Promise<WeatherDay[]>;
}
