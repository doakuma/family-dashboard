// POST /api/setup/complete의 본체: 본문 모양 확인 -> repo.applySetup -> HTTP 응답으로 번역. (세션·출처·본문 크기 검사는 route.ts)
// repo는 WikiRepository.applySetup만 안다(위키 쓰기는 항상 저장소 메서드 하나).
//
// 슬랙 연결(#19): 본문의 connectCodes([{memberId, memberKey, code}])를 저장소의 연결 기록(claim)과 맞춰 구성원의 slackId를 **서버가** 채운다.
// 클라이언트가 보낸 slackId는 받지 않는다(만들어 보낸 값이 위키 member 파일에 들어가면 남의 계정으로 쓸 수 있으므로): setup.members[].slackId가 있으면 422로 거부한다.
import { SetupError, isConnectCode, setupSchema, type ConnectCodeStore, type FamilyId, type Member, type SetupIssue, type WikiRepository } from "@hsh/core";
import { z } from "zod";
import { MEMBER_KEY_RE } from "./connect";

export type CompleteBody =
  | { ok: true; synced: boolean; syncError?: string; /** 코드를 받았지만 연결이 끝나지 않아 슬랙 ID를 못 넣은 구성원 id (슬랙 ID는 싣지 않는다) */ unlinked?: string[] }
  | { ok: false; code: "bad_request" | "invalid" | "already_done" | "needs_confirm" | "read_only" | "write_failed"; message: string; issues?: SetupIssue[] };

export interface CompleteResult {
  status: 200 | 400 | 409 | 422 | 500 | 503;
  body: CompleteBody;
}

const connectCodesSchema = z.array(z.strictObject({ memberId: z.string().min(1).max(64), memberKey: z.string().regex(MEMBER_KEY_RE), code: z.string().refine(isConnectCode) })).max(12);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const invalid = (issues: SetupIssue[]): CompleteResult => ({ status: 422, body: { ok: false, code: "invalid", message: "입력한 내용을 다시 확인해 주세요", issues } });

export type ConnectResolver = Pick<ConnectCodeStore, "claimed" | "clearScope">;

export async function runSetup(
  raw: unknown,
  repo: Pick<WikiRepository, "applySetup">,
  familyId: FamilyId,
  log: (m: string) => void = console.error,
  info: (m: string) => void = console.info,
  connect?: ConnectResolver,
): Promise<CompleteResult> {
  const codes = isRecord(raw) ? connectCodesSchema.safeParse(raw.connectCodes ?? []) : undefined;
  if (!isRecord(raw) || !("setup" in raw) || (raw.overwrite !== undefined && typeof raw.overwrite !== "boolean") || !codes?.success) {
    return { status: 400, body: { ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요" } };
  }
  // 슬랙 ID는 서버가 연결 기록에서 채운다. 클라이언트가 보낸 값은 조용히 지우지 않고 거부한다(잘못된 클라이언트·조작을 드러내려고)
  const sentMembers = isRecord(raw.setup) && Array.isArray(raw.setup.members) ? raw.setup.members : [];
  const forged = sentMembers.flatMap((m, i) => (isRecord(m) && m.slackId !== undefined ? [{ path: `members.${i}.slackId`, message: "슬랙 ID는 직접 보낼 수 없어요. 슬랙에서 연결 코드를 보내 연결해 주세요" }] : []));
  if (forged.length > 0) return invalid(forged);
  // 포트는 검증된 SetupInput만 받는다. 검증 실패는 422(필드별 issues). 구현(applySetup)도 쓰기 직전에 다시 검증한다.
  const parsed = setupSchema.safeParse(raw.setup);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return { status: 422, body: { ok: false, code: "invalid", message: "입력한 내용을 다시 확인해 주세요", issues } };
  }
  const linked = await linkSlack(parsed.data.members, codes.data, connect);
  if (!linked.ok) return invalid(linked.issues);
  try {
    const r = await repo.applySetup(familyId, { ...parsed.data, members: linked.members }, { overwrite: raw.overwrite === true });
    // 저장 버전은 서버 로그에만 남기고 응답에는 싣지 않는다(저장 방식의 세부를 화면에 내보내지 않음).
    info(`[setup] 위키 저장 version=${r.version} synced=${r.synced}`);
    // 세팅이 끝났으니 이 범위의 연결 코드를 모두 폐기한다(실패해도 세팅은 성공: 코드는 만료로 사라진다)
    await connect?.clearScope("setup").catch((e: unknown) => log(`[setup] 연결 코드 정리 실패: ${e instanceof Error ? e.message : String(e)}`));
    return { status: 200, body: { ok: true, synced: r.synced, ...(r.syncError ? { syncError: r.syncError } : {}), ...(linked.unlinked.length ? { unlinked: linked.unlinked } : {}) } };
  } catch (e) {
    if (e instanceof SetupError) {
      const status = { invalid: 422, already_done: 409, needs_confirm: 409, read_only: 503 }[e.code] as 409 | 422 | 503;
      const message = {
        invalid: "입력한 내용을 다시 확인해 주세요",
        already_done: "이미 세팅이 끝났어요",
        needs_confirm: "이전 세팅 파일이 남아 있어요. 덮어쓰기를 확인해 주세요",
        read_only: "위키에 쓸 수 없는 설정이에요. 서버의 WIKI_REPO_PATH를 확인해 주세요",
      }[e.code];
      return { status, body: { ok: false, code: e.code, message, ...(e.code === "invalid" ? { issues: e.issues } : {}) } };
    }
    // git 오류 등: 내용은 서버 로그에만 남기고 화면에는 일반 문구
    log(`[setup] 위키 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 500, body: { ok: false, code: "write_failed", message: "위키에 저장하지 못했어요. 서버 로그를 확인해 주세요" } };
  }
}

type Codes = z.infer<typeof connectCodesSchema>;
type Linked = { ok: true; members: Member[]; unlinked: string[] } | { ok: false; issues: SetupIssue[] };

/**
 * 구성원에 연결 기록의 slackId를 넣는다.
 * - 연결이 안 끝난 코드(아직 DM 전·만료·없는 코드)는 건너뛴다: 그 구성원은 슬랙 ID 없이 만들어지고 unlinked로 알린다(나중에 설정에서 연결 - #22).
 * - 거부(422): 없는 구성원 id, 같은 구성원·같은 코드 중복, 코드가 다른 구성원(memberKey)의 것, 한 슬랙 계정이 두 구성원에.
 */
async function linkSlack(members: Member[], codes: Codes, connect?: ConnectResolver): Promise<Linked> {
  const issues: SetupIssue[] = [];
  const slackOf = new Map<string, string>();
  const unlinked: string[] = [];
  const usedCodes = new Set<string>();
  const usedSlack = new Map<string, string>();
  for (const [i, c] of codes.entries()) {
    const at = (f: string) => `connectCodes.${i}.${f}`;
    if (!members.some((m) => m.id === c.memberId)) {
      issues.push({ path: at("memberId"), message: "등록되지 않은 구성원이에요" });
      continue;
    }
    if (slackOf.has(c.memberId) || unlinked.includes(c.memberId) || usedCodes.has(c.code)) {
      issues.push({ path: at("code"), message: "같은 구성원이나 같은 코드를 두 번 보냈어요" });
      continue;
    }
    usedCodes.add(c.code);
    const got = await connect?.claimed(c.code);
    if (!got || got.record.scope !== "setup") {
      unlinked.push(c.memberId);
      continue;
    }
    if (got.record.memberKey !== c.memberKey) {
      issues.push({ path: at("memberKey"), message: "연결 코드가 이 구성원의 것이 아니에요" });
      continue;
    }
    const other = usedSlack.get(got.slackId);
    if (other) {
      issues.push({ path: at("code"), message: "한 슬랙 계정은 한 구성원에만 연결할 수 있어요" });
      continue;
    }
    usedSlack.set(got.slackId, c.memberId);
    slackOf.set(c.memberId, got.slackId);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, members: members.map((m) => (slackOf.has(m.id) ? { ...m, slackId: slackOf.get(m.id) } : m)), unlinked };
}
