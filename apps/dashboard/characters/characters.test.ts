import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHARACTER_IDS, SKIN_IDS } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { SKINS_DIR } from "../skins/read-tokens";
import { SKIN_MANIFESTS } from "../skins";
import { ASSET_EXTENSIONS, characterManifestSchema, isSafeAssetPath } from "./contract";
import { CHARACTERS, CHARACTER_MANIFESTS, getCharacter } from "./index";

const CHARACTERS_DIR = import.meta.dirname;
const dirs = readdirSync(CHARACTERS_DIR).filter((n) => statSync(join(CHARACTERS_DIR, n)).isDirectory());
const appDir = join(CHARACTERS_DIR, "..");

/** 폴더 안 모든 파일(상대 경로) */
function walk(dir: string, base = ""): string[] {
  return readdirSync(join(dir, base)).flatMap((n) => {
    const rel = base ? `${base}/${n}` : n;
    return statSync(join(dir, rel)).isDirectory() ? walk(dir, rel) : [rel];
  });
}

describe("캐릭터 구조", () => {
  it("폴더 이름 = manifest id = core CHARACTER_IDS", () => {
    expect([...dirs].sort()).toEqual([...CHARACTER_IDS].sort());
    for (const id of CHARACTER_IDS) {
      expect(CHARACTER_MANIFESTS[id].id).toBe(id);
      const onDisk = JSON.parse(readFileSync(join(CHARACTERS_DIR, id, "manifest.json"), "utf8"));
      expect(onDisk.id, id).toBe(id);
    }
    expect(CHARACTERS.map((c) => c.id)).toEqual([...CHARACTER_IDS]);
  });

  it("character는 아직 none뿐 (새 캐릭터 추가는 오너 결정, 0013)", () => {
    expect([...CHARACTER_IDS]).toEqual(["none"]);
  });

  it("매니페스트가 스키마를 통과하고 오리지널 선언(original: true)이 있다", () => {
    for (const id of CHARACTER_IDS) {
      const raw = JSON.parse(readFileSync(join(CHARACTERS_DIR, id, "manifest.json"), "utf8"));
      const r = characterManifestSchema.safeParse(raw);
      expect(r.success, id).toBe(true);
      expect(raw.original, id).toBe(true);
    }
  });

  it("매니페스트에 선언한 에셋 파일이 실제로 있고, 폴더에는 선언하지 않은 파일이 없다", () => {
    for (const id of CHARACTER_IDS) {
      const dir = join(CHARACTERS_DIR, id);
      const assets = CHARACTER_MANIFESTS[id].assets;
      for (const a of assets) expect(existsSync(join(dir, a)), `${id}/${a}`).toBe(true);
      expect(walk(dir).filter((f) => f !== "manifest.json" && !assets.includes(f)), `${id}: 선언 안 된 파일`).toEqual([]);
    }
  });

  it("스킨 토큰이 없다: 캐릭터 폴더에 CSS가 없고 어떤 파일에도 `--*` 정의가 없다 (색·글꼴은 스킨만 바꾼다)", () => {
    for (const id of CHARACTER_IDS) {
      const files = walk(join(CHARACTERS_DIR, id));
      expect(files.filter((f) => /\.(css|scss|js|ts|tsx|woff2?|ttf|otf)$/i.test(f)), id).toEqual([]);
      for (const f of files.filter((f) => /\.(json|svg)$/.test(f))) {
        const text = readFileSync(join(CHARACTERS_DIR, id, f), "utf8");
        expect(text, `${id}/${f}`).not.toMatch(/(^|[\s;{"'(])--[a-z][a-z0-9-]*\s*:/);
        expect(text, `${id}/${f}`).not.toMatch(/data-skin/);
      }
    }
  });

  it("스킨 폴더·tokens.css는 캐릭터를 모른다 (서로 독립 층)", () => {
    for (const id of SKIN_IDS) {
      const css = readFileSync(join(SKINS_DIR, id, "tokens.css"), "utf8");
      expect(css, id).not.toMatch(/data-character/);
    }
  });

  it("모든 스킨 × 모든 캐릭터 조합이 유효하다", () => {
    expect(SKIN_IDS.length * CHARACTER_IDS.length).toBeGreaterThan(0);
    for (const skin of SKIN_IDS) {
      for (const character of CHARACTER_IDS) {
        expect(SKIN_MANIFESTS[skin].id, `${skin}×${character}`).toBe(skin);
        expect(characterManifestSchema.safeParse(CHARACTER_MANIFESTS[character]).success, `${skin}×${character}`).toBe(true);
      }
    }
  });

  it("getCharacter: none이면 null, 그 밖에는 매니페스트", () => {
    expect(getCharacter("none")).toBeNull();
    for (const id of CHARACTER_IDS.filter((i) => i !== "none")) expect(getCharacter(id)?.id).toBe(id);
  });

  it("layout.tsx가 <html data-character>를 서버가 config로 렌더한다", () => {
    const layout = readFileSync(join(appDir, "app/layout.tsx"), "utf8");
    expect(layout).toContain("data-character={getCharacterForLayout()}");
  });
});

describe("매니페스트 스키마", () => {
  const ok = { id: "x", name: "엑스", version: "1", original: true, assets: ["a.svg", "img/b.png", "c.webp"] };
  it("original이 true가 아니거나 없으면 거절", () => {
    expect(characterManifestSchema.safeParse(ok).success).toBe(true);
    expect(characterManifestSchema.safeParse({ ...ok, original: false }).success).toBe(false);
    expect(characterManifestSchema.safeParse({ ...ok, original: undefined }).success).toBe(false);
  });
  it("에셋은 폴더 안 상대 경로의 svg/png/webp만", () => {
    for (const bad of ["../a.svg", "a/../../b.svg", "/etc/a.svg", "C:/a.svg", "a\\b.svg", "a.css", "a.gif", "noext", "a//b.svg", "./a.svg", "tokens.css"]) {
      expect(isSafeAssetPath(bad), bad).toBe(false);
      expect(characterManifestSchema.safeParse({ ...ok, assets: [bad] }).success, bad).toBe(false);
    }
    for (const good of ["a.svg", "dir/b.PNG", "c.webp"]) expect(isSafeAssetPath(good), good).toBe(true);
    expect(ASSET_EXTENSIONS).toEqual(["svg", "png", "webp"]);
  });
  it("모르는 필드는 거절(strict)", () => {
    expect(characterManifestSchema.safeParse({ ...ok, color: "#fff" }).success).toBe(false);
  });
});
