// POST /api/setup/complete의 본체: 본문 모양 확인 -> repo.applySetup -> HTTP 응답으로 번역. (세션·출처·본문 크기 검사는 route.ts)
// repo는 WikiRepository.applySetup만 안다(위키 쓰기는 항상 저장소 메서드 하나).
import { SetupError, setupSchema, type FamilyId, type SetupIssue, type WikiRepository } from "@hsh/core";

export type CompleteBody =
  | { ok: true; synced: boolean; syncError?: string }
  | { ok: false; code: "bad_request" | "invalid" | "already_done" | "needs_confirm" | "read_only" | "write_failed"; message: string; issues?: SetupIssue[] };

export interface CompleteResult {
  status: 200 | 400 | 409 | 422 | 500 | 503;
  body: CompleteBody;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function runSetup(raw: unknown, repo: Pick<WikiRepository, "applySetup">, familyId: FamilyId, log: (m: string) => void = console.error, info: (m: string) => void = console.info): Promise<CompleteResult> {
  if (!isRecord(raw) || !("setup" in raw) || (raw.overwrite !== undefined && typeof raw.overwrite !== "boolean")) {
    return { status: 400, body: { ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요" } };
  }
  // 포트는 검증된 SetupInput만 받는다. 검증 실패는 422(필드별 issues). 구현(applySetup)도 쓰기 직전에 다시 검증한다.
  const parsed = setupSchema.safeParse(raw.setup);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return { status: 422, body: { ok: false, code: "invalid", message: "입력한 내용을 다시 확인해 주세요", issues } };
  }
  try {
    const r = await repo.applySetup(familyId, parsed.data, { overwrite: raw.overwrite === true });
    // 저장 버전은 서버 로그에만 남기고 응답에는 싣지 않는다(저장 방식의 세부를 화면에 내보내지 않음).
    info(`[setup] 위키 저장 version=${r.version} synced=${r.synced}`);
    return { status: 200, body: { ok: true, synced: r.synced, ...(r.syncError ? { syncError: r.syncError } : {}) } };
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
