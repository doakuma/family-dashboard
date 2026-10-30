// POST /api/setup/complete의 본체: 본문 모양 확인 -> repo.applySetup -> HTTP 응답으로 번역. (세션·출처·본문 크기 검사는 route.ts)
// repo는 WikiRepository.applySetup만 안다(위키 쓰기는 항상 저장소 메서드 하나).
import { SetupError, type SetupIssue, type WikiRepository } from "@hsh/core";

export type CompleteBody =
  | { ok: true; commit: string; pushed: boolean; pushError?: string }
  | { ok: false; code: "bad_request" | "invalid" | "already_done" | "needs_confirm" | "read_only" | "write_failed"; message: string; issues?: SetupIssue[] };

export interface CompleteResult {
  status: 200 | 400 | 409 | 422 | 500 | 503;
  body: CompleteBody;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function runSetup(raw: unknown, repo: Pick<WikiRepository, "applySetup">, log: (m: string) => void = console.error): Promise<CompleteResult> {
  if (!isRecord(raw) || !("setup" in raw) || (raw.overwrite !== undefined && typeof raw.overwrite !== "boolean")) {
    return { status: 400, body: { ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요" } };
  }
  try {
    // setup의 검증은 applySetup(setupSchema)이 한다. 여기서 한 번 더 모양을 만들지 않는다.
    const r = await repo.applySetup(raw.setup as Parameters<WikiRepository["applySetup"]>[0], { overwrite: raw.overwrite === true });
    return { status: 200, body: { ok: true, commit: r.commit, pushed: r.pushed, ...(r.pushError ? { pushError: r.pushError } : {}) } };
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
