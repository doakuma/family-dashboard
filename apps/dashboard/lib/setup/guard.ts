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

const NO_SESSION = {
  setup: "세션이 끝났어요. 태블릿의 QR코드를 다시 찍어 주세요",
  settings: "세션이 끝났어요. PIN을 다시 입력해 주세요",
} as const;
const ALLOWED_VIA = { setup: ["setup"], settings: ["pin", "setup"] } as const;

/** 세션 종류(via)가 허용 목록에 있어야 통과하는 공통 관문. /api/setup/*은 setup만, /api/settings는 pin(과 같은 PIN을 거친 setup) */
export async function guardJson(req: Request, deps: GuardDeps, maxBytes: number, via: "setup" | "settings"): Promise<{ ok: true; value: unknown } | GuardFail> {
  if (!deps.isSameOrigin(req)) return { ok: false, status: 403, body: { ok: false, code: "forbidden", message: "허용되지 않은 출처예요" } };
  const session = await deps.readSession();
  if (!session?.via || !(ALLOWED_VIA[via] as readonly string[]).includes(session.via)) return { ok: false, status: 401, body: { ok: false, code: "no_session", message: NO_SESSION[via] } };
  const read = await readSmallJson(req, maxBytes);
  if (!read.ok) return { ok: false, status: read.status, body: { ok: false, code: "bad_request", message: "요청 형식이 올바르지 않아요" } };
  return { ok: true, value: read.value };
}

export const guardSetupJson = (req: Request, deps: GuardDeps, maxBytes: number) => guardJson(req, deps, maxBytes, "setup");
/**
 * /api/settings: PIN 세션(via=pin). 마법사 세션(via=setup)도 같은 PIN을 거쳤으므로 기존대로 /settings가 열린다(0002) -
 * 다만 세팅 전에는 설정 변경이 needs_setup(409)으로 거부되고, 세팅이 끝나면 마법사 세션은 폐기된다. 같은 순서(출처 -> 세션 -> 본문)
 */
export const guardSettingsJson = (req: Request, deps: GuardDeps, maxBytes: number) => guardJson(req, deps, maxBytes, "settings");

/** 연결 코드 API 본문 상한: 코드 12개 정도라 1KB면 충분 */
export const MAX_CONNECT_BYTES = 1024;

/** 설정 API 본문 상한: 가장 큰 것도 이름 한 줄 정도 */
export const MAX_SETTINGS_BYTES = 2048;
