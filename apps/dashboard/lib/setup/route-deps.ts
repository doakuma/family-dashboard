// /api/setup/* route handler가 같이 쓰는 실제 의존(Next 전용). 본체 로직은 lib/setup/*.ts에 있고 거기서 시험한다.
import "server-only";
import { NextResponse } from "next/server";
import { isSameOrigin, readSession } from "@/lib/auth/server";
import { getConnectStore, getSetupContext } from "@/lib/state";
import type { ConnectApiDeps } from "./connect";
import { guardSetupJson } from "./guard";

export const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export const guardRequest = (req: Request, maxBytes: number) => guardSetupJson(req, { isSameOrigin, readSession }, maxBytes);

export const connectDeps = (): ConnectApiDeps => ({
  store: getConnectStore(),
  needsSetup: async () => (await getSetupContext()).needsSetup,
});

