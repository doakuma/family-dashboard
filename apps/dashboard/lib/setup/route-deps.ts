// /api/setup/* route handler가 같이 쓰는 실제 의존(Next 전용). 본체 로직은 lib/setup/*.ts에 있고 거기서 시험한다.
import "server-only";
import { NextResponse } from "next/server";
import { isSameOrigin, readSession } from "@/lib/auth/server";
import { getConnectStore, getNoticeStore, getSetupContext } from "@/lib/state";
import type { ConnectApiDeps } from "./connect";
import { guardSetupJson } from "./guard";

export const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export const guardRequest = (req: Request, maxBytes: number) => guardSetupJson(req, { isSameOrigin, readSession }, maxBytes);

/** 상태 폴더 설정이 잘못되면(상대 경로·위키 안) 던지지 않고 undefined: 호출자가 503으로 안내한다 */
export function tryConnectStore(): ReturnType<typeof getConnectStore> | undefined {
  try {
    return getConnectStore();
  } catch (e) {
    console.error(`[setup] ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** 상태 폴더 설정이 잘못돼도 세팅은 막지 않는다: 알림 상자 없이(환영 메시지만 빠짐) 진행하고 로그만 남긴다 */
export function tryNoticeStore(): ReturnType<typeof getNoticeStore> | undefined {
  try {
    return getNoticeStore();
  } catch (e) {
    console.error(`[setup] 환영 알림 상자를 열지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

export const STATE_DIR_MISSING = { ok: false, code: "read_only", message: "연결 코드를 저장할 폴더 설정이 올바르지 않아요. 서버의 HSH_STATE_DIR을 확인해 주세요" } as const;

export const connectDeps = (): ConnectApiDeps | undefined => {
  const store = tryConnectStore();
  return store && { store, needsSetup: async () => (await getSetupContext()).needsSetup };
};

