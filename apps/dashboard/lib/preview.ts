// 시안·점검용 미리보기 쿼리(?at ?mode ?skin ?character). 개발 모드에서만 받고 운영에서는 무시한다(결정 0005).
import { isCharacterId, isSkinId, type CharacterId, type SkinId } from "@hsh/core";

export interface PreviewParams {
  at?: string;
  mode?: "day" | "night";
  skin?: SkinId;
  character?: CharacterId;
}

export function parsePreview(params: { at?: string; mode?: string; skin?: string; character?: string }, enabled: boolean): PreviewParams {
  if (!enabled) return {};
  return {
    at: params.at && !Number.isNaN(Date.parse(params.at)) ? params.at : undefined,
    mode: params.mode === "night" || params.mode === "day" ? params.mode : undefined,
    skin: isSkinId(params.skin) ? params.skin : undefined,
    character: isCharacterId(params.character) ? params.character : undefined,
  };
}
