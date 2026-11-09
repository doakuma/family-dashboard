// 슬랙 연결 코드 API의 본체(#19). 본문 모양 확인 -> 세팅 필요 확인 -> 저장소 호출 -> HTTP 응답. (출처·세션·본문 크기는 lib/setup/guard.ts + route.ts)
// 슬랙 ID는 저장소 안에서만 돌고 브라우저로 나가지 않는다: 상태 응답은 코드별 pending|connected|expired만 준다.
import { CONTROL_CHARS, ConnectStoreError, isConnectCode, type ConnectCodeState, type ConnectCodeStore } from "@hsh/core";
import { z } from "zod";

export interface ConnectApiDeps {
  store: Pick<ConnectCodeStore, "issue" | "states" | "revoke">;
  /** 세팅이 필요한 상태인지(끝났으면 409) */
  needsSetup: () => Promise<boolean>;
  log?: (message: string) => void;
}

export type IssueBody =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; code: "bad_request" | "already_done" | "too_many" | "failed"; message: string };
export type StatusBody =
  | { ok: true; states: Record<string, ConnectCodeState> }
  | { ok: false; code: "bad_request" | "already_done" | "failed"; message: string };

export interface ApiResult<B> {
  status: 200 | 400 | 409 | 422 | 429 | 500;
  body: B;
}

const MSG = {
  bad: "요청 형식이 올바르지 않아요",
  done: "이미 세팅이 끝났어요",
  many: "연결 코드를 너무 많이 받았어요. 잠시 뒤에 다시 해 주세요",
  failed: "연결 코드를 처리하지 못했어요. 잠시 뒤에 다시 해 주세요",
} as const;

/** 마법사 draft의 구성원 키(m1, m2…). 파일 이름이 아니라 기록 안의 값이지만 모양을 좁혀 둔다 */
export const MEMBER_KEY_RE = /^[A-Za-z0-9_-]{1,10}$/;

const issueSchema = z.strictObject({
  memberKey: z.string().regex(MEMBER_KEY_RE),
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine((s) => !CONTROL_CHARS.test(s)),
  role: z.enum(["guardian", "child"]),
});

/** 상태 조회 상한: 구성원 12명 */
export const MAX_STATUS_CODES = 12;
const statusSchema = z.strictObject({ codes: z.array(z.string().refine(isConnectCode)).min(1).max(MAX_STATUS_CODES) });

export async function issueConnectCode(raw: unknown, deps: ConnectApiDeps): Promise<ApiResult<IssueBody>> {
  const p = issueSchema.safeParse(raw);
  if (!p.success) return { status: 422, body: { ok: false, code: "bad_request", message: MSG.bad } };
  const log = deps.log ?? ((m) => console.error(`[setup] ${m}`));
  try {
    if (!(await deps.needsSetup())) return { status: 409, body: { ok: false, code: "already_done", message: MSG.done } };
    const r = await deps.store.issue({ memberKey: p.data.memberKey, name: p.data.name, role: p.data.role, scope: "setup" });
    return { status: 200, body: { ok: true, code: r.code, expiresAt: r.expiresAt } };
  } catch (e) {
    if (e instanceof ConnectStoreError) return { status: 429, body: { ok: false, code: "too_many", message: MSG.many } };
    log(`연결 코드 발급 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 500, body: { ok: false, code: "failed", message: MSG.failed } };
  }
}

export async function connectStatus(raw: unknown, deps: ConnectApiDeps): Promise<ApiResult<StatusBody>> {
  const p = statusSchema.safeParse(raw);
  if (!p.success) return { status: 422, body: { ok: false, code: "bad_request", message: MSG.bad } };
  const log = deps.log ?? ((m) => console.error(`[setup] ${m}`));
  try {
    if (!(await deps.needsSetup())) return { status: 409, body: { ok: false, code: "already_done", message: MSG.done } };
    return { status: 200, body: { ok: true, states: await deps.store.states(p.data.codes) } };
  } catch (e) {
    log(`연결 상태 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 500, body: { ok: false, code: "failed", message: MSG.failed } };
  }
}

const revokeSchema = z.strictObject({ code: z.string().refine(isConnectCode) });

export type RevokeBody = { ok: true } | { ok: false; code: "bad_request" | "already_done" | "failed"; message: string };

/**
 * 마법사가 코드를 버릴 때(구성원 삭제·이름·역할 변경) 서버의 코드와 연결 기록도 푼다.
 * 연결 기록이 남으면 그 슬랙 계정이 "이미 다른 구성원으로 연결됨"으로 막히기 때문(0007). 없는 코드여도 성공.
 */
export async function revokeConnectCode(raw: unknown, deps: ConnectApiDeps): Promise<ApiResult<RevokeBody>> {
  const p = revokeSchema.safeParse(raw);
  if (!p.success) return { status: 422, body: { ok: false, code: "bad_request", message: MSG.bad } };
  const log = deps.log ?? ((m) => console.error(`[setup] ${m}`));
  try {
    if (!(await deps.needsSetup())) return { status: 409, body: { ok: false, code: "already_done", message: MSG.done } };
    await deps.store.revoke(p.data.code);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    log(`연결 코드 폐기 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 500, body: { ok: false, code: "failed", message: MSG.failed } };
  }
}
