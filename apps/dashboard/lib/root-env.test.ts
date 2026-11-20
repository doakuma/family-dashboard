import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadRootEnv, shouldLoadRootEnv, skipRootEnvWarning } from "./root-env";

describe("루트 .env 읽기 스위치", () => {
  it("기본은 읽는다", () => {
    const loader = vi.fn();
    const warn = vi.fn();
    expect(loadRootEnv(loader, "/root", true, {}, warn)).toBe(true);
    expect(loader).toHaveBeenCalledWith("/root", true);
    expect(warn).not.toHaveBeenCalled();
  });
  it("HSH_SKIP_ROOT_ENV=1이면 읽지 않고 경고도 없다", () => {
    const loader = vi.fn();
    const warn = vi.fn();
    expect(loadRootEnv(loader, "/root", false, { HSH_SKIP_ROOT_ENV: "1" }, warn)).toBe(false);
    expect(loader).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
  it("1이 아닌 값(none·true·0)은 켜지지 않고 경고 한 줄", () => {
    for (const v of ["none", "true", "0"]) {
      const loader = vi.fn();
      const warn = vi.fn();
      expect(loadRootEnv(loader, "/root", false, { HSH_SKIP_ROOT_ENV: v }, warn)).toBe(true);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });
  it("빈 값은 경고 없이 읽는다", () => {
    expect(skipRootEnvWarning({ HSH_SKIP_ROOT_ENV: "  " })).toBeNull();
    expect(shouldLoadRootEnv({ HSH_SKIP_ROOT_ENV: "" })).toBe(true);
  });
});

describe("e2e 격리", () => {
  const dir = join(__dirname, "..", "e2e");
  const files = readdirSync(dir).filter((f) => f.endsWith(".e2e.mjs"));
  it("e2e 파일이 있다", () => expect(files.length).toBeGreaterThan(0));
  // 서버를 직접 띄우는 호출(spawn·fork·exec·execFile)은 금지. 예외: spawnSync(connect-claim tsx)와 execFileSync(git·npm·pin-hash)는 서버가 아니다.
  it.each(files)("%s: 서버는 spawnServer로만 띄운다", (f) => {
    const src = readFileSync(join(dir, f), "utf8");
    const code = src.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/(?<![\w.])(spawn|fork|exec|execFile)\s*\(/);
    expect(code).not.toMatch(/import\s*\{[^}]*\b(spawn|fork|exec|execFile)\b[^}]*\}\s*from\s*"node:child_process"/);
    expect(code).not.toMatch(/child_process\.(spawn|fork|exec|execFile)\b/);
    if (/server\.ts|next\/dist\/bin\/next/.test(code)) {
      expect(code).toContain('from "./isolation.mjs"');
      expect(code).toMatch(/spawnServer\(/);
    }
  });
  it("spawnServer: 호출자가 덮어도 격리 값이 남고 부모 env 위에 합친다", async () => {
    const { spawnServer } = (await import(/* @vite-ignore */ join(dir, "isolation.mjs"))) as {
      spawnServer: (args: string[], o: { cwd: string; env?: Record<string, string | undefined>; spawnFn: (...a: unknown[]) => unknown }) => unknown;
    };
    const spawnFn = vi.fn(() => ({}));
    spawnServer(["server.ts"], { cwd: "/x", env: { PORT: "1", HSH_SKIP_ROOT_ENV: "0", NODE_ENV: undefined }, spawnFn });
    const [cmd, args, opts] = spawnFn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string | undefined> }];
    expect(cmd).toBe("node");
    expect(args).toEqual(["server.ts"]);
    expect(opts.env.HSH_SKIP_ROOT_ENV).toBe("1");
    expect(opts.env.PORT).toBe("1");
    expect("NODE_ENV" in opts.env && opts.env.NODE_ENV === undefined).toBe(true);
  });
});
