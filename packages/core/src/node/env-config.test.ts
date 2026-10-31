import { describe, expect, it } from "vitest";
import { DEFAULT_FAMILY_ID } from "../types";
import { EnvConfigProvider } from "./env-config";

describe("EnvConfigProvider", () => {
  it("값이 없으면 기본값", () => {
    const c = new EnvConfigProvider({});
    expect(c.get("familyId")).toBe(DEFAULT_FAMILY_ID);
    expect(c.get("nodeEnv")).toBe("development");
    expect(c.get("port")).toBe(3000);
    expect(c.get("wikiRepoPath")).toBeUndefined();
    expect(c.get("llm")).toEqual({ provider: "ollama", baseUrl: undefined, model: undefined, timeoutMs: 180000, numCtx: 8192, keepAlive: "30m" });
    expect(c.get("slack")).toEqual({ botToken: undefined, appToken: undefined, familyChannel: undefined });
  });

  it("Ollama 호출 설정: OLLAMA_TIMEOUT_MS·OLLAMA_NUM_CTX·OLLAMA_KEEP_ALIVE, 잘못된 값은 기본값", () => {
    const llm = (env: Record<string, string>) => new EnvConfigProvider(env).get("llm");
    expect(llm({ OLLAMA_TIMEOUT_MS: "240000", OLLAMA_NUM_CTX: "4096", OLLAMA_KEEP_ALIVE: "1h" })).toMatchObject({ timeoutMs: 240000, numCtx: 4096, keepAlive: "1h" });
    expect(llm({ OLLAMA_KEEP_ALIVE: "-1" })).toMatchObject({ keepAlive: "-1" });
    for (const bad of ["abc", "0", "-5", "1.5", "", "12px"]) {
      expect(llm({ OLLAMA_TIMEOUT_MS: bad, OLLAMA_NUM_CTX: bad }), bad).toMatchObject({ timeoutMs: 180000, numCtx: 8192 });
    }
    expect(llm({ OLLAMA_KEEP_ALIVE: "오래" })).toMatchObject({ keepAlive: "30m" });
  });

  it("환경 변수를 키로 매핑한다", () => {
    const c = new EnvConfigProvider({ NODE_ENV: "production", PORT: "3100", WIKI_REPO_PATH: "/w", DASHBOARD_BASE_URL: "http://a:3000", ADMIN_PIN_HASH: "h", HSH_FAMILY_ID: "kim-family", SLACK_BOT_TOKEN: "xoxb-1", SLACK_APP_TOKEN: "xapp-1" });
    expect(c.get("nodeEnv")).toBe("production");
    expect(c.get("port")).toBe(3100);
    expect(c.get("wikiRepoPath")).toBe("/w");
    expect(c.get("dashboardBaseUrl")).toBe("http://a:3000");
    expect(c.get("adminPinHash")).toBe("h");
    expect(c.get("familyId")).toBe("kim-family");
    expect(c.get("slack")).toMatchObject({ botToken: "xoxb-1", appToken: "xapp-1" });
  });

  it("호출할 때마다 읽는다(캐시하지 않음)", () => {
    const env: Record<string, string | undefined> = {};
    const c = new EnvConfigProvider(env);
    expect(c.get("wikiRepoPath")).toBeUndefined();
    env.WIKI_REPO_PATH = "/later";
    expect(c.get("wikiRepoPath")).toBe("/later");
  });

  it("LLM 설정 오류는 llm 키를 읽을 때만 던진다", () => {
    const c = new EnvConfigProvider({ LLM_PROVIDER: "anthropic" });
    expect(c.get("port")).toBe(3000);
    expect(() => c.get("llm")).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => new EnvConfigProvider({ LLM_PROVIDER: "x" }).get("llm")).toThrow(/알 수 없는/);
    expect(new EnvConfigProvider({ LLM_PROVIDER: "Anthropic", ANTHROPIC_API_KEY: "k" }).get("llm")).toMatchObject({ provider: "anthropic", apiKey: "k" });
  });

  it("잘못된 가족 id는 거부", () => {
    expect(() => new EnvConfigProvider({ HSH_FAMILY_ID: "Bad Id" }).get("familyId")).toThrow();
  });
});
