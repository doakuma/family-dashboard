// 캐릭터 계약: 캐릭터는 스킨(색·글꼴·장식)과 별도 층이다. 색·글꼴 토큰을 정의하지 못하고, 그림 에셋만 가진다.
// 오리지널 캐릭터만 허용한다(기존 IP 금지, 스펙). `original: true` 선언이 없으면 매니페스트가 통과하지 못한다.
import { z } from "zod";

/** 허용 에셋 확장자(그림만. 코드·CSS·폰트는 못 싣는다) */
export const ASSET_EXTENSIONS = ["svg", "png", "webp"] as const;

/** 캐릭터 폴더 안의 상대 경로만: 절대 경로·`..`·역슬래시·빈 조각 금지, 허용 확장자만 */
export function isSafeAssetPath(p: string): boolean {
  if (p.startsWith("/") || p.includes("\\") || /^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return false;
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  return p.includes(".") && (ASSET_EXTENSIONS as readonly string[]).includes(ext);
}

export const characterManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  /** 기존 IP 캐릭터가 아니라는 선언. true만 허용 */
  original: z.literal(true),
  description: z.string().optional(),
  /** 폴더 안 그림 파일의 상대 경로 목록(none은 빈 목록) */
  assets: z.array(z.string().refine(isSafeAssetPath, "폴더 안 상대 경로의 svg/png/webp만")),
}).strict();

export type CharacterManifest = z.infer<typeof characterManifestSchema>;
