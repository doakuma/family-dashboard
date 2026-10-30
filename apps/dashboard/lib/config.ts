// 서버 전용 설정 경계. 앱 코드는 process.env를 직접 읽지 않고 여기서 ConfigProvider로 받는다(결정 0003).
// "server-only"라서 클라이언트 컴포넌트가 불러오면 빌드가 실패한다(비밀값이 브라우저 번들로 새지 않게).
// 예외(직접 process.env): server.ts(Next보다 먼저 뜨는 부트스트랩), proxy.ts(서버가 만든 내부 증명 비밀값), e2e 스크립트, .claude 훅.
import "server-only";
import { EnvConfigProvider } from "@hsh/core/node";

export const config = new EnvConfigProvider();

/** 주소·Host·출처 검사가 보는 값 */
export function netConfig() {
  return { dashboardBaseUrl: config.get("dashboardBaseUrl"), nodeEnv: config.get("nodeEnv"), port: config.get("port") };
}
