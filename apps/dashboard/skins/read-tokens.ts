// 테스트용: 스킨 CSS에서 토큰 값을 읽는다. 앱 코드는 이 파일을 쓰지 않는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SKINS_DIR = import.meta.dirname;

export type TokenMap = Record<string, string>;

/** `--name: value;` 선언을 모은다. 값 끝의 주석은 뺀다. */
function declarations(block: string): TokenMap {
  const body = block.replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
}

function blockOf(css: string, selector: string): TokenMap | undefined {
  const esc = selector.replace(/[[\]"=]/g, "\\$&");
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return m ? declarations(m[1] ?? "") : undefined;
}

export interface SkinTokens {
  /** 낮 블록에 직접 정의된 토큰 */
  day: TokenMap;
  /** 어두운 톤 블록에 직접 정의된 토큰(낮 값과 합치지 않은 원본) */
  dimOwn: TokenMap;
  /** 어두운 톤에서 실제로 적용되는 값(낮 + 덮어쓴 값) */
  dim: TokenMap;
}

export function readSkinTokens(id: string): SkinTokens {
  const css = readFileSync(join(SKINS_DIR, id, "tokens.css"), "utf8");
  const day = blockOf(css, `[data-skin="${id}"]`) ?? {};
  const dimOwn = blockOf(css, `[data-skin="${id}"][data-tone="dim"]`) ?? {};
  return { day, dimOwn, dim: { ...day, ...dimOwn } };
}
