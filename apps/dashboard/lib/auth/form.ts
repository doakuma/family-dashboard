// 로그인·세팅 폼 본문 읽기. 파싱 실패는 500이 아니라 400, 너무 큰 본문은 읽지 않고 413.
export const MAX_FORM_BYTES = 4096;

export type FormRead = { ok: true; form: URLSearchParams } | { ok: false; status: 400 | 411 | 413 | 415 };

/** PIN 폼은 application/x-www-form-urlencoded만 쓴다(PinForm은 일반 폼 POST). */
export async function readSmallForm(req: Request): Promise<FormRead> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return { ok: false, status: 415 };
  const raw = req.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return { ok: false, status: 411 };
  if (Number(raw) > MAX_FORM_BYTES) return { ok: false, status: 413 };
  try {
    const text = await req.text();
    // content-length를 믿지 않고 실제 길이도 확인한다
    if (new TextEncoder().encode(text).length > MAX_FORM_BYTES) return { ok: false, status: 413 };
    return { ok: true, form: new URLSearchParams(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** /setup 마법사 완료 요청(JSON)의 상한. 구성원 12명·기념일 60건을 넣어도 수 KB라 여유 있게 32KB */
export const MAX_JSON_BYTES = 32 * 1024;

export type JsonRead = { ok: true; value: unknown } | { ok: false; status: 400 | 411 | 413 | 415 };

/** JSON 본문 읽기. 폼과 같은 규칙(content-length 필수, 상한 초과는 읽지 않고 413, 실제 길이도 확인, 파싱 실패 400). */
export async function readSmallJson(req: Request, maxBytes: number = MAX_JSON_BYTES): Promise<JsonRead> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return { ok: false, status: 415 };
  const raw = req.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return { ok: false, status: 411 };
  if (Number(raw) > maxBytes) return { ok: false, status: 413 };
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413 };
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
