// 마법사 3단계가 연결 코드 API를 부르는 부분(브라우저). 응답은 믿고 캐스팅하지 않고 safeParse한다. fetch는 인자로 받아 시험한다.
import type { MemberRole } from "@hsh/core";
import { z } from "zod";

export type ConnectState = "pending" | "connected" | "expired";

const issueOk = z.object({ ok: z.literal(true), code: z.string().regex(/^\d{6}$/), expiresAt: z.string() });
const statusOk = z.object({ ok: z.literal(true), states: z.record(z.string(), z.enum(["pending", "connected", "expired"])) });

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 상태 코드 -> 화면 문구. 서버 문구를 그대로 쓰지 않고(내부 정보 방지) 아는 상태만 말한다 */
export function connectErrorMessage(status: number | undefined): string {
  if (status === 401) return "세팅 시간이 지나 연결이 끊겼어요. 태블릿의 QR코드를 다시 찍어 PIN을 입력해 주세요.";
  if (status === 409) return "이미 세팅이 끝났어요.";
  if (status === 429) return "코드를 너무 많이 받았어요. 잠시 뒤에 다시 해 주세요.";
  if (status === undefined) return "서버에 연결하지 못했어요. 집 와이파이에 연결되어 있는지 확인해 주세요.";
  return "코드를 받지 못했어요. 잠시 뒤에 다시 해 주세요.";
}

async function post(path: string, body: unknown, f: Fetch, signal?: AbortSignal): Promise<{ status: number; json: unknown } | undefined> {
  try {
    const res = await f(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", signal });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  } catch {
    return undefined;
  }
}

export type IssueResult = { ok: true; code: string; expiresAt: string } | { ok: false; message: string };

export async function requestConnectCode(m: { key: string; name: string; role: MemberRole }, f: Fetch = fetch): Promise<IssueResult> {
  const r = await post("/api/setup/connect", { memberKey: m.key, name: m.name.trim(), role: m.role }, f);
  const ok = r?.status === 200 ? issueOk.safeParse(r.json) : undefined;
  if (ok?.success) return { ok: true, code: ok.data.code, expiresAt: ok.data.expiresAt };
  return { ok: false, message: connectErrorMessage(r?.status) };
}

export type StatusResult = { ok: true; states: Record<string, ConnectState> } | { ok: false; status?: number; message: string };

export async function fetchConnectStates(codes: readonly string[], f: Fetch = fetch, signal?: AbortSignal): Promise<StatusResult> {
  const r = await post("/api/setup/connect/status", { codes }, f, signal);
  const ok = r?.status === 200 ? statusOk.safeParse(r.json) : undefined;
  if (ok?.success) return { ok: true, states: ok.data.states };
  return { ok: false, status: r?.status, message: connectErrorMessage(r?.status) };
}

/** 버린 코드를 서버에서도 푼다. 실패해도(네트워크·세션) 마법사는 계속된다: 코드는 만료되거나 다시 받으면 풀린다 */
export async function revokeConnectCode(code: string, f: Fetch = fetch): Promise<boolean> {
  const r = await post("/api/setup/connect/revoke", { code }, f);
  return r?.status === 200;
}

/** 이전 draft에 있던 코드 중 다음 draft에 더는 없는 것(구성원 삭제·이름·역할 변경·다시 받기로 바뀐 코드) */
export function droppedCodes(before: readonly { connectCode?: string }[], after: readonly { connectCode?: string }[]): string[] {
  const keep = new Set(after.flatMap((m) => (m.connectCode ? [m.connectCode] : [])));
  return before.flatMap((m) => (m.connectCode && !keep.has(m.connectCode) ? [m.connectCode] : []));
}
