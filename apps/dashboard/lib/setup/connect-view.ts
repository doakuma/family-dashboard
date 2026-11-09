// 3단계 구성원 한 줄의 표시 상태. 화면(SlackStep)은 이 값을 그리기만 한다.
import type { ConnectState } from "./connect-client";

export type ConnectView =
  | { kind: "none" }
  /** 코드를 받았고 아직 DM 전(상태를 아직 모르는 동안도 여기) */
  | { kind: "pending"; code: string }
  | { kind: "connected"; code: string }
  | { kind: "expired"; code: string };

export function connectView(code: string | undefined, state: ConnectState | undefined): ConnectView {
  if (!code) return { kind: "none" };
  if (state === "connected") return { kind: "connected", code };
  if (state === "expired") return { kind: "expired", code };
  return { kind: "pending", code };
}

/** 슬랙으로 보낼 글 */
export const dmText = (code: string) => `연결 ${code}`;

/** 상태가 바뀌었을 때 스크린리더에 읽어 줄 문구(aria-live). 바뀐 게 없으면 undefined */
export function announcement(name: string, before: ConnectState | undefined, after: ConnectState | undefined): string | undefined {
  if (before === after || after === undefined) return undefined;
  if (after === "connected") return `${name} 님이 슬랙에 연결됐어요.`;
  if (after === "expired" && before === "pending") return `${name} 님의 연결 코드 시간이 지났어요. 다시 받아 주세요.`;
  return undefined;
}

/** 이 단계에서 아직 폴링이 필요한 코드(연결됨·만료는 더 바뀌지 않는다) */
export const pollableCodes = (members: readonly { connectCode?: string }[], states: Readonly<Record<string, ConnectState | undefined>>): string[] =>
  members.flatMap((m) => (m.connectCode && states[m.connectCode] !== "connected" && states[m.connectCode] !== "expired" ? [m.connectCode] : []));
