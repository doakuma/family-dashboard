import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHARACTER_IDS, SKIN_IDS, isSkinId, parseConfigFile } from "@hsh/core";
import { describe, expect, it } from "vitest";
import { MEMBER_COLORS, colorOf } from "../lib/palette";
import { contrast, deltaE } from "./color";
import { COLOR_TOKENS, COMMON_TOKENS, MEMBER_COLOR_SLOTS, SHAPE_TOKENS } from "./contract";
import { SKINS, SKIN_MANIFESTS } from "./index";
import { SKINS_DIR, readSkinTokens } from "./read-tokens";

const appDir = join(SKINS_DIR, "..");
const dirs = readdirSync(SKINS_DIR).filter((n) => statSync(join(SKINS_DIR, n)).isDirectory());

// ---- 기준 (판단 기록: docs/decisions/0005-skins.md) ----
/** 구성원 색 슬롯 사이 최소 색차(CIE76 ΔE). 모든 쌍에 적용. 20 이상이면 점·막대를 나란히 놓아도 다른 색으로 읽힌다. */
const MIN_MEMBER_DELTA_E = 20;
/** 구성원 색(점·막대)과 바탕의 최소 명암비. 글자가 아니라 그래픽 요소 기준(WCAG 1.4.11) 3:1. */
const MIN_MEMBER_CONTRAST = 3;

describe("스킨 구조", () => {
  it("폴더 이름 = manifest id = core SKIN_IDS", () => {
    expect([...dirs].sort()).toEqual([...SKIN_IDS].sort());
    for (const id of SKIN_IDS) expect(SKIN_MANIFESTS[id].id).toBe(id);
    expect(SKINS.map((s) => s.id)).toEqual([...SKIN_IDS]);
  });

  it("스킨 폴더에는 tokens.css와 manifest.json만 있다", () => {
    for (const id of SKIN_IDS) expect(readdirSync(join(SKINS_DIR, id)).sort()).toEqual(["manifest.json", "tokens.css"]);
  });

  it("두 번째 스킨은 임시 검증용 표시가 있고 default는 없다", () => {
    expect(SKIN_MANIFESTS.default.temporary).toBeUndefined();
    expect(SKIN_MANIFESTS.paper.temporary).toBe(true);
  });

  it("layout.tsx가 모든 스킨 CSS를 import한다 (지연 로드 없이 번들에 포함)", () => {
    const layout = readFileSync(join(appDir, "app/layout.tsx"), "utf8");
    for (const id of SKIN_IDS) expect(layout).toContain(`import "../skins/${id}/tokens.css"`);
  });

  it("<html>에 기본 data-skin이 있다 (스킨 CSS가 닿기 전에도 토큰이 정의됨)", () => {
    expect(readFileSync(join(appDir, "app/layout.tsx"), "utf8")).toContain('data-skin="default"');
  });

  it("character는 아직 none뿐", () => {
    expect([...CHARACTER_IDS]).toEqual(["none"]);
  });

  it("스킨은 글자 크기 하한(공통 토큰)을 덮어쓰지 못한다", () => {
    for (const id of SKIN_IDS) {
      const t = readSkinTokens(id);
      for (const name of COMMON_TOKENS) {
        expect(t.day[name], `${id} 낮`).toBeUndefined();
        expect(t.dimOwn[name], `${id} dim`).toBeUndefined();
      }
    }
  });
});

for (const id of SKIN_IDS) {
  describe(`스킨 ${id}`, () => {
    const t = readSkinTokens(id);

    it("계약의 모든 토큰을 낮 블록에 정의한다", () => {
      expect([...COLOR_TOKENS, ...SHAPE_TOKENS].filter((n) => !t.day[n])).toEqual([]);
    });

    it("어두운 톤(dim) 블록이 모든 색 토큰을 다시 정의한다 (낮 색이 야간에 남지 않게)", () => {
      expect(COLOR_TOKENS.filter((n) => !t.dimOwn[n])).toEqual([]);
    });

    it("계약에 없는 토큰을 정의하지 않는다 (위젯이 모르는 토큰 금지)", () => {
      const known = new Set<string>([...COLOR_TOKENS, ...SHAPE_TOKENS]);
      expect(Object.keys({ ...t.day, ...t.dimOwn }).filter((n) => !known.has(n))).toEqual([]);
    });

    it("색 슬롯은 정확히 8개이고 서로 다른 값이다", () => {
      expect(MEMBER_COLOR_SLOTS).toHaveLength(8);
      for (const tone of [t.day, t.dim]) {
        const values = MEMBER_COLOR_SLOTS.map((n) => tone[`member-${n}`]);
        expect(new Set(values).size).toBe(8);
      }
    });

    for (const [label, tone] of [["낮", t.day], ["어두운 톤", t.dim]] as const) {
      it(`${label}: 구성원 색 슬롯 모든 쌍이 ΔE >= ${MIN_MEMBER_DELTA_E} (서로 구분)`, () => {
        const close: string[] = [];
        for (const [i, a] of MEMBER_COLOR_SLOTS.entries()) {
          for (const b of MEMBER_COLOR_SLOTS.slice(i + 1)) {
            const d = deltaE(tone[`member-${a}`] ?? "", tone[`member-${b}`] ?? "");
            if (d < MIN_MEMBER_DELTA_E) close.push(`${a}~${b} ΔE=${d.toFixed(1)}`);
          }
        }
        expect(close).toEqual([]);
      });

      it(`${label}: 구성원 색이 달력 종이·바탕 위에서 ${MIN_MEMBER_CONTRAST}:1 이상 (점·막대가 보임)`, () => {
        const low: string[] = [];
        for (const n of MEMBER_COLOR_SLOTS) {
          for (const bg of ["paper", "sheet"] as const) {
            const c = contrast(tone[`member-${n}`] ?? "", tone[bg] ?? "");
            if (c < MIN_MEMBER_CONTRAST) low.push(`${n} on ${bg} ${c.toFixed(2)}`);
          }
        }
        expect(low).toEqual([]);
      });
    }

    it("낮과 어두운 톤은 바탕이 확연히 다르다", () => {
      expect(contrast(t.day.paper ?? "", t.dim.paper ?? "")).toBeGreaterThan(5);
    });
  });
}

describe("두 스킨은 확연히 다르다 (전환 검증이 의미 있게)", () => {
  const [d, p] = [readSkinTokens("default").day, readSkinTokens("paper").day];
  it("바탕·글자 색이 다르다", () => {
    expect(deltaE(d.paper ?? "", p.paper ?? "")).toBeGreaterThan(8);
    expect(deltaE(d.ink ?? "", p.ink ?? "")).toBeGreaterThan(5);
  });
  it("모서리·그림자·글꼴 중 둘 이상이 다르다", () => {
    const diff = ["radius-lg", "shadow-card", "font-display"].filter((k) => d[k] !== p[k]);
    expect(diff.length).toBeGreaterThanOrEqual(2);
  });
});

describe("구성원 색 이름 -> 슬롯 토큰", () => {
  it("위키의 색 이름은 var(--member-<name>)이 된다", () => {
    for (const n of MEMBER_COLOR_SLOTS) expect(colorOf(n)).toBe(`var(--member-${n})`);
    expect(MEMBER_COLORS.coral).toBe("var(--member-coral)");
  });
  it("모르는 이름·없음은 gray 슬롯, #hex는 그대로", () => {
    expect(colorOf(undefined)).toBe("var(--member-gray)");
    expect(colorOf("Blue")).toBe("var(--member-gray)");
    expect(colorOf("#ff8800")).toBe("#ff8800");
  });
});

describe("글자 크기 하한", () => {
  const floor = /--text-floor:\s*([\d.]+)rem/.exec(readFileSync(join(appDir, "app/globals.css"), "utf8"));
  const floorRem = Number(floor?.[1]);
  // 태블릿 화면(대시보드·위젯·야간·세팅 필요 안내). 휴대폰 /setup 폼은 따로 16px 기준.
  const tabletCss = ["components/Dashboard.module.css", "components/SetupNeeded.module.css", ...readdirSync(join(appDir, "components/widgets")).filter((n) => n.endsWith(".css")).map((n) => `components/widgets/${n}`)];

  it("하한 토큰이 있다: 1280×800(1rem=16px)에서 12px 이상", () => {
    expect(floorRem).toBeGreaterThanOrEqual(0.75);
    expect(floorRem * 16).toBeGreaterThanOrEqual(12);
  });

  it("태블릿 화면의 모든 font-size가 rem이고 하한 이상이다", () => {
    const bad: string[] = [];
    let count = 0;
    for (const f of tabletCss) {
      const css = readFileSync(join(appDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
        count++;
        const v = (m[1] ?? "").trim();
        const rem = /^([\d.]+)rem$/.exec(v);
        if (!rem || Number(rem[1]) < floorRem) bad.push(`${f}: ${v}`);
      }
    }
    expect(count).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});

describe("config.md의 skin·character 읽기 (관용)", () => {
  const read = (fm: string) => {
    const warnings: string[] = [];
    const c = parseConfigFile(`---\nfamilyName: 햇살네\n${fm}---\n`, (m) => warnings.push(m));
    return { c, warnings };
  };
  it("없으면 없는 것이고(해석은 default/none) 경고 없음", () => {
    const { c, warnings } = read("");
    expect(c?.skin).toBeUndefined();
    expect(c?.character).toBeUndefined();
    expect(warnings).toEqual([]);
  });
  it("알려진 스킨은 그대로", () => {
    for (const id of SKIN_IDS) expect(read(`skin: ${id}\n`).c?.skin).toBe(id);
  });
  it("모르는 값은 default/none + 경고", () => {
    const { c, warnings } = read("skin: neon\ncharacter: robot\n");
    expect(c?.skin).toBe("default");
    expect(c?.character).toBe("none");
    expect(warnings).toHaveLength(2);
    expect(isSkinId("neon")).toBe(false);
  });
});
