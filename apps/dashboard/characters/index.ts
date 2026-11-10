// 캐릭터 목록. 폴더 이름 = id = core의 CHARACTER_IDS. 스킨(skins/)과 독립 층이라 서로 아무것도 import하지 않는다.
// 캐릭터를 화면에 그리는 컴포넌트·자리는 아직 없다(배치는 오너 결정 대기, #29는 구조·로더·none까지).
import { CHARACTER_IDS, type CharacterId } from "@hsh/core";
import noneManifest from "./none/manifest.json";
import { characterManifestSchema, type CharacterManifest } from "./contract";

export const CHARACTER_MANIFESTS: Record<CharacterId, CharacterManifest> = {
  none: characterManifestSchema.parse(noneManifest),
};

export const CHARACTERS: CharacterManifest[] = CHARACTER_IDS.map((id) => CHARACTER_MANIFESTS[id]);

/** 캐릭터 매니페스트. `none`(캐릭터 없음)이면 null - 호출하는 쪽이 그릴 것이 없다고 바로 알 수 있게. */
export function getCharacter(id: CharacterId): CharacterManifest | null {
  return id === "none" ? null : CHARACTER_MANIFESTS[id];
}
