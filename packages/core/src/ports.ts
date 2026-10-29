// 어댑터 인터페이스 — 위젯은 타입만 알고, 입력·저장·외부 서비스는 이 뒤에 숨긴다.
import type { Change, Event, IncomingMessage, WeatherDay, WikiState } from "./types";

/** 저장소: 위키 파일 ↔ 도메인 타입 */
export interface WikiRepository {
  read(): Promise<WikiState>;
  /** 파일 수정 + commit + push */
  apply(change: Change): Promise<{ commit: string }>;
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
