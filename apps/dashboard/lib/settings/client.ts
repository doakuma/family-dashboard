// /settings 화면이 POST /api/settings를 부르는 부분(브라우저). 응답은 믿고 캐스팅하지 않고 safeParse한다. fetch는 인자로 받아 시험한다.
import type { MemberRole } from "@hsh/core";
import { z } from "zod";
import type { StatusResult } from "../setup/connect-client";

const viewSchema = z.object({
  familyName: z.string(),
  region: z.string().optional(),
  regionKey: z.string().optional(),
  members: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(["guardian", "child"]), color: z.string(), connected: z.boolean() })),
  maxMembers: z.number(),
});
export type SettingsViewData = z.infer<typeof viewSchema>;

const okSchema = z.object({
  ok: z.literal(true),
  saved: z.literal(true).optional(),
  synced: z.boolean().optional(),
  syncError: z.string().optional(),
  view: viewSchema.optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
  expiresAt: z.string().optional(),
  states: z.record(z.string(), z.enum(["pending", "connected", "expired"])).optional(),
});
const failSchema = z.object({
  ok: z.literal(false),
  code: z.string().optional(),
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type SettingsRequest =
  | { kind: "member.add"; name: string; role: MemberRole; color: string }
  | { kind: "member.color"; id: string; color: string }
  | { kind: "region"; regionKey: string }
  | { kind: "slack.code"; id: string }
  | { kind: "slack.status"; codes: readonly string[] }
  | { kind: "slack.save"; id: string; code: string }
  | { kind: "slack.unlink"; id: string };

export type SettingsOk = z.infer<typeof okSchema>;
export type SettingsReply = { ok: true; body: SettingsOk } | { ok: false; status?: number; code?: string; message: string; issues: { path: string; message: string }[] };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 서버가 문구를 주지 않는 경우(연결 실패·세션·알 수 없는 응답)의 화면 문구. 서버 내부 정보는 쓰지 않는다 */
export function settingsErrorMessage(status: number | undefined): string {
  if (status === 401) return "설정 시간이 지나 연결이 끊겼어요. 이 화면을 새로고침해서 PIN을 다시 입력해 주세요.";
  if (status === 403) return "이 주소에서는 바꿀 수 없어요. 태블릿에 나온 주소로 다시 열어 주세요.";
  if (status === undefined) return "서버에 연결하지 못했어요. 집 와이파이에 연결되어 있는지 확인해 주세요.";
  return "저장하지 못했어요. 잠시 뒤에 다시 해 주세요.";
}

export async function postSettings(body: SettingsRequest, f: Fetch = fetch, signal?: AbortSignal): Promise<SettingsReply> {
  let res: Response;
  try {
    res = await f("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", signal });
  } catch {
    return { ok: false, message: settingsErrorMessage(undefined), issues: [] };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  if (res.ok) {
    const ok = okSchema.safeParse(json);
    if (ok.success) return { ok: true, body: ok.data };
    return { ok: false, status: res.status, message: settingsErrorMessage(res.status), issues: [] };
  }
  const fail = failSchema.safeParse(json);
  // 서버가 직접 쓴 안내 문구(409·422·503)는 그대로 보이고, 세션·출처는 우리 문구를 쓴다
  const own = fail.success && res.status !== 401 && res.status !== 403 && res.status < 500 ? fail.data.message : undefined;
  const server503 = fail.success && res.status === 503 ? fail.data.message : undefined;
  return { ok: false, status: res.status, code: fail.success ? fail.data.code : undefined, message: own ?? server503 ?? settingsErrorMessage(res.status), issues: fail.success ? (fail.data.issues ?? []) : [] };
}

/** 연결 상태 조회(연결 상태 훅이 쓰는 모양으로 맞춘다) */
export async function fetchSettingsConnectStates(codes: readonly string[], f: Fetch = fetch, signal?: AbortSignal): Promise<StatusResult> {
  const r = await postSettings({ kind: "slack.status", codes }, f, signal);
  if (r.ok && r.body.states) return { ok: true, states: r.body.states };
  return { ok: false, status: r.ok ? undefined : r.status, message: r.ok ? settingsErrorMessage(500) : r.message };
}
