// 어댑터 인터페이스 — 위젯은 타입만 알고, 입력·저장·외부 서비스는 이 뒤에 숨긴다.
// 저장 방식(git 파일, DB 등)의 용어는 여기에 쓰지 않는다(결정 0003). 구현 세부는 구현 클래스 안에만 둔다.
import type { Change, Event, FamilyId, IncomingMessage, SetupInput, WeatherDay, WikiState } from "./types";

/** 쓰기 결과: 저장은 끝났고, 다른 저장 위치(원격 등)와의 동기화는 실패할 수 있다. */
export interface WriteResult {
  /** 이 쓰기까지 반영된 위키 버전. 값의 모양은 구현이 정하는 불투명 문자열이다(비교·로그용). */
  version: string;
  /** 동기화(백업·공유 위치로의 반영)까지 끝났는지. 동기화 대상이 없거나 꺼져 있으면 false */
  synced: boolean;
  /** 동기화가 실패했으면 사람이 읽을 원인 요약. 성공·건너뜀이면 없음 */
  syncError?: string;
}

/** 저장소: 위키 문서 ↔ 도메인 타입. 모든 메서드는 가족(familyId) 단위로 동작한다. */
export interface WikiRepository {
  read(familyId: FamilyId): Promise<WikiState>;
  /** 변경을 저장한다. 동기화가 실패해도 저장은 남고 synced:false(+원인 syncError)로 알린다. */
  apply(familyId: FamilyId, change: Change): Promise<WriteResult>;
  /**
   * 첫 세팅(/setup 마법사) 전용. 가족 설정·구성원·기념일(+ 변경 기록 한 줄)을 하나의 저장 단위로 쓴다.
   * `Change`가 아니라 LLM·봇 경로에서는 부를 수 없는 내부 메서드다. 세팅이 필요한 위키(needsSetup)에서만 쓸 수 있다.
   * 실패하면 원래대로 되돌린다. 거부 사유는 `SetupError`(already_done·needs_confirm·invalid·read_only).
   */
  applySetup(familyId: FamilyId, setup: SetupInput, opts?: { overwrite?: boolean }): Promise<WriteResult>;
}

/** 메신저: 슬랙 1차, 이후 추가 */
export interface MessengerAdapter {
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
  confirm(msg: IncomingMessage, preview: string, change: Change): Promise<void>;
  reply(msg: IncomingMessage, text: string): Promise<void>;
}

/** LLM: 의도 추출은 "시스템 프롬프트 + 메시지 → JSON 한 개"만 필요하므로 포트를 이만큼으로 좁힌다. 모델·키·제공자는 구현이 안다. */
export interface LlmRequest {
  system: string;
  user: string;
  /** 응답 JSON 스키마 (구현이 structured output 등으로 전달) */
  schema: Record<string, unknown>;
}

export interface LlmAdapter {
  /** 로그·시험 출력용 이름 (예: "ollama:qwen3:8b") */
  readonly name: string;
  /** 응답 본문을 JSON으로 파싱한 값. 검증은 호출하는 쪽에서 한다. */
  json(req: LlmRequest): Promise<unknown>;
}

/** 외부 서비스 */
export interface CalendarSync {
  upsert(e: Event): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface WeatherSource {
  week(): Promise<WeatherDay[]>;
}
