// 스킨 목록. 폴더 이름 = id = core의 SKIN_IDS. CSS는 app/layout.tsx가 전부 import한다(지연 로드 없음).
import { SKIN_IDS, type SkinId } from "@hsh/core";
import defaultManifest from "./default/manifest.json";
import paperManifest from "./paper/manifest.json";
import type { SkinManifest } from "./contract";

export const SKIN_MANIFESTS: Record<SkinId, SkinManifest> = {
  default: defaultManifest,
  paper: paperManifest,
};

export const SKINS: SkinManifest[] = SKIN_IDS.map((id) => SKIN_MANIFESTS[id]);
