// /api/setup/* route handler가 같이 쓰는 실제 의존(Next 전용). 본체 로직은 lib/setup/*.ts에 있고 거기서 시험한다.
import "server-only";
import { NextResponse } from "next/server";
import { isSameOrigin, readSession } from "@/lib/auth/server";
import { getConnectStore, getSetupContext } from "@/lib/state";
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

export const STATE_DIR_MISSING = { ok: false, code: "read_only", message: "연결 코드를 저장할 폴더 설정이 올바르지 않아요. 서버의 HSH_STATE_DIR을 확인해 주세요" } as const;

export const connectDeps = (): ConnectApiDeps | undefined => {
  const store = tryConnectStore();
  return store && { store, needsSetup: async () => (await getSetupContext()).needsSetup };
};

