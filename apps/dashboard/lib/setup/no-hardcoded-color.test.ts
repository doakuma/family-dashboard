import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 마법사·폼 조각은 색을 토큰(var(--…))이나 palette(구성원 색 이름)로만 쓴다. 파일 안에 #hex를 직접 쓰지 않는다.
const root = join(import.meta.dirname, "../..");
const dirs = ["components/setup", "components/setup/steps", "components/ui/form"];
const files = dirs.flatMap((d) => readdirSync(join(root, d)).filter((n) => /\.(css|tsx?)$/.test(n)).map((n) => join(d, n)));

describe("하드코딩 색 금지 (setup·form)", () => {
  it("검사 대상 파일을 찾았다", () => {
    expect(files.length).toBeGreaterThan(15);
  });
  for (const f of files) {
    it(f, () => {
      const text = readFileSync(join(root, f), "utf8");
      expect(text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
      expect(text.match(/\brgba?\(|\bhsla?\(/g) ?? []).toEqual([]);
    });
  }
});
