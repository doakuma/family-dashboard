// POST /api/setup/complete 응답을 화면에서 읽는 모양. 서버가 보낸 JSON이라도 믿고 캐스팅하지 않고 safeParse한다.
import { z } from "zod";

const okBody = z.object({ ok: z.literal(true), synced: z.boolean(), syncError: z.string().optional() });
const failBody = z.object({
  ok: z.literal(false),
  code: z.string().optional(),
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type CompleteOk = z.infer<typeof okBody>;
export type CompleteFail = z.infer<typeof failBody>;

/** 모양이 다르면 undefined (호출자는 일반 오류 문구를 보인다) */
export function parseCompleteResponse(raw: unknown): CompleteOk | CompleteFail | undefined {
  const r = z.union([okBody, failBody]).safeParse(raw);
  return r.success ? r.data : undefined;
}
