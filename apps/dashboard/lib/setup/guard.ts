// /api/setup/* 공통 관문(#17의 방어): 폼 출처 -> 세션(via=setup) -> 본문 형식·크기. 통과하면 파싱한 JSON을 돌려준다.
// 의존(출처 검사·세션 읽기)은 인자로 받아 Next 없이 시험한다. route.ts가 실제 구현을 넣는다.
import { readSmallJson } from "../auth/form";

export interface GuardDeps {
  isSameOrigin: (req: Request) => boolean;
  readSession: () => Promise<{ via?: string } | undefined>;
}

export interface GuardFail {
  ok: false;
  status: 400 | 401 | 403 | 411 | 413 | 415;
  body: { ok: false; code: "forbidden" | "no_session" | "bad_request"; message: string };
}

export async function guardSetupJson(req: Request, deps: GuardDeps, maxBytes: number): Promise<{ ok: true; value: unknown } | GuardFail> {
  if (!deps.isSameOrigin(req)) return { ok: false, status: 403, body: { ok: false, code: "forbidden", message: "허용되지 않은 출처예요" } };
  const session = await deps.readSession();
  if (session?.via !== "setup") return { ok: false, status: 401, body: { ok: false, code: "no_session", message: "세션이 끝났어요. 태블릿의 QR코드를 다시 찍어 주세요" } };
  const read = await readSmallJson(req, maxBytes);
  if (!read.ok) return { ok: false, status: read.status, body: { ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요" } };
  return { ok: true, value: read.value };
}

/** 연결 코드 API 본문 상한: 코드 12개 정도라 1KB면 충분 */
export const MAX_CONNECT_BYTES = 1024;
