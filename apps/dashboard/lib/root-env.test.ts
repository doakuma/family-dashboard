import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadRootEnv, shouldLoadRootEnv } from "./root-env";

describe("루트 .env 읽기 스위치", () => {
  it("기본은 읽는다", () => {
    const loader = vi.fn();
    expect(loadRootEnv(loader, "/root", true, {})).toBe(true);
    expect(loader).toHaveBeenCalledWith("/root", true);
  });
  it("HSH_ENV_FILE=none이면 읽지 않는다", () => {
    const loader = vi.fn();
    expect(loadRootEnv(loader, "/root", false, { HSH_ENV_FILE: "none" })).toBe(false);
    expect(loader).not.toHaveBeenCalled();
    expect(shouldLoadRootEnv({ HSH_ENV_FILE: " None " })).toBe(false);
    expect(shouldLoadRootEnv({ HSH_ENV_FILE: "" })).toBe(true);
  });
});

describe("e2e 격리", () => {
  const dir = join(__dirname, "..", "e2e");
  const files = readdirSync(dir).filter((f) => f.endsWith(".e2e.mjs"));
  it("e2e 파일이 있다", () => expect(files.length).toBeGreaterThan(0));
  it.each(files)("%s: 서버 자식 env에 e2eEnv 격리를 넣는다", (f) => {
    const src = readFileSync(join(dir, f), "utf8");
    const spawns = src.match(/spawn\("node"/g)?.length ?? 0;
    const uses = src.match(/\.\.\.ISOLATED_ENV/g)?.length ?? 0;
    expect(src).toContain('from "./isolation.mjs"');
    expect(uses).toBeGreaterThanOrEqual(1);
    expect(uses).toBeGreaterThanOrEqual(spawns > 0 ? 1 : 0);
    expect(src).not.toMatch(/\.env는 읽지 않는다\.?\s*$/m);
  });
  it("격리 변수가 스위치와 같은 이름이다", () => {
    const iso = readFileSync(join(dir, "isolation.mjs"), "utf8");
    expect(iso).toContain("HSH_ENV_FILE");
    expect(iso).toContain('"none"');
  });
});
