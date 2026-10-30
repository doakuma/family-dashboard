// 설정·비밀값 포트. 앱 코드는 process.env를 직접 읽지 않고 ConfigProvider로 받는다(결정 0003).
// MVP 구현은 환경 변수(core/node의 EnvConfigProvider) 하나. 서비스는 DB·비밀 저장소 구현으로 바꾼다.
// 비밀값이 들어 있으므로 이 값을 브라우저 번들·공개 응답으로 보내지 않는다(대시보드에서는 서버 전용 모듈에서만 쓴다).
import type { FamilyId } from "./types";

export type LlmConfig =
  | { provider: "ollama"; baseUrl?: string; model?: string }
  | { provider: "anthropic"; apiKey: string; model?: string };

export interface SlackConfig {
  /** xoxb- 봇 토큰. MVP는 이 하나로 설치 한 건을 만든다(installationStore) */
  botToken?: string;
  /** xapp- Socket Mode 앱 토큰 */
  appToken?: string;
  familyChannel?: string;
}

export interface AppConfig {
  /** MVP는 값 하나. 서비스에서는 요청·설치마다 정해진다 */
  familyId: FamilyId;
  /** production이 아니면 development로 본다(예시 위키·localhost 허용 같은 개발 편의의 기준) */
  nodeEnv: "production" | "development";
  port: number;
  /** ?at·?mode·?skin 미리보기 쿼리를 받는지. 개발 모드에서만 켜지고, 운영 기본값은 꺼짐(e2e만 HSH_PREVIEW_QUERY=1로 켠다) */
  previewQuery: boolean;
  /** 위키 저장소 위치(FsWikiRepository 전용). 서비스 저장소에서는 쓰지 않는다 */
  wikiRepoPath?: string;
  /** 태블릿 QR·출처 확인의 기준 주소 */
  dashboardBaseUrl?: string;
  /** 관리자 PIN 해시(`pnpm pin:hash`). 없으면 아무도 /setup에 못 들어간다 */
  adminPinHash?: string;
  /** 잘못된 설정이면 읽을 때 던진다(LLM을 쓰지 않는 앱이 죽지 않게 이 키를 읽을 때만) */
  llm: LlmConfig;
  slack: SlackConfig;
}

/**
 * 키를 하나씩 읽는다. 동기 인터페이스다: 환경 변수는 값이 이미 메모리에 있고, DB 구현은 시작할 때 읽어 캐시해 두는 쪽으로 맞춘다
 * (가족별 값이 필요해지면 `get(key, familyId)`로 넓힌다 - 결정 0003 반영 기록 참고).
 */
export interface ConfigProvider {
  get<K extends keyof AppConfig>(key: K): AppConfig[K];
}
