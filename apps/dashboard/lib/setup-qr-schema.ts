// /api/setup-qr 응답 검증. 브라우저와 서버가 같이 쓴다(server-only 아님).
// svg는 dangerouslySetInnerHTML로 그리므로 '<svg'로 시작하는 문자열만 받는다(서버가 만든 QR만 온다는 전제의 최소 확인).
import { z } from "zod";

export const setupQrSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), label: z.string(), url: z.string(), svg: z.string().startsWith("<svg") }),
  z.object({ ok: z.literal(false), reason: z.enum(["missing", "invalid"]) }),
]);

export type SetupQrView = z.infer<typeof setupQrSchema>;
