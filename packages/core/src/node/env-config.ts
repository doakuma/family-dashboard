// ConfigProvider의 MVP 구현: 환경 변수(.env는 실행 전에 이미 process.env에 들어와 있다).
// 호출할 때마다 읽는다(캐시 없음) - 시작 직후에 환경이 바뀌는 순서(server.ts의 loadEnvConfig 선로딩)에 영향받지 않게.
import { DEFAULT_OLLAMA_KEEP_ALIVE, DEFAULT_OLLAMA_NUM_CTX, DEFAULT_OLLAMA_TIMEOUT_MS, type AppConfig, type ConfigProvider, type LlmConfig } from "../config";
import { DEFAULT_FAMILY_ID, asFamilyId } from "../types";

type Env = Readonly<Record<string, string | undefined>>;

const blank = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

/** 양의 정수만 받는다. 숫자가 아니거나 0 이하면 기본값. */
function posInt(v: string | undefined, fallback: number): number {
  const s = blank(v);
  if (!s || !/^\d+$/.test(s)) return fallback;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
/** Ollama keep_alive: 30m, 1h, 300s, 0, -1 꼴만 받는다. 아니면 기본값. */
function keepAlive(v: string | undefined): string {
  const s = blank(v);
  return s && /^(-?\d+(\.\d+)?(ms|s|m|h)?)$/.test(s) ? s : DEFAULT_OLLAMA_KEEP_ALIVE;
}

function llmFromEnv(env: Env): LlmConfig {
  const provider = (env.LLM_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic에는 ANTHROPIC_API_KEY가 필요합니다");
    return { provider, apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || undefined };
  }
  if (provider === "ollama") {
    return {
      provider,
      baseUrl: env.OLLAMA_BASE_URL || undefined,
      model: env.OLLAMA_MODEL || undefined,
      timeoutMs: posInt(env.OLLAMA_TIMEOUT_MS, DEFAULT_OLLAMA_TIMEOUT_MS),
      numCtx: posInt(env.OLLAMA_NUM_CTX, DEFAULT_OLLAMA_NUM_CTX),
      keepAlive: keepAlive(env.OLLAMA_KEEP_ALIVE),
    };
  }
  throw new Error(`알 수 없는 LLM_PROVIDER: ${provider}`);
}

export class EnvConfigProvider implements ConfigProvider {
  /** env: 기본은 process.env. 시험에서는 객체를 넣는다. */
  constructor(private readonly env: Env = process.env) {}

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    const env = this.env;
    const values: { [P in keyof AppConfig]: () => AppConfig[P] } = {
      familyId: () => {
        const id = blank(env.HSH_FAMILY_ID);
        return id ? asFamilyId(id) : DEFAULT_FAMILY_ID;
      },
      nodeEnv: () => (env.NODE_ENV === "production" ? "production" : "development"),
      previewQuery: () => env.NODE_ENV !== "production" || env.HSH_PREVIEW_QUERY === "1",
      port: () => Number(blank(env.PORT) ?? 3000),
      wikiRepoPath: () => env.WIKI_REPO_PATH || undefined,
      dashboardBaseUrl: () => env.DASHBOARD_BASE_URL,
      adminPinHash: () => env.ADMIN_PIN_HASH,
      llm: () => llmFromEnv(env),
      slack: () => ({ botToken: env.SLACK_BOT_TOKEN || undefined, appToken: env.SLACK_APP_TOKEN || undefined, familyChannel: env.SLACK_FAMILY_CHANNEL || undefined }),
    };
    return (values[key] as () => AppConfig[K])();
  }
}
