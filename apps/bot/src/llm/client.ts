// LlmAdapter(@hsh/core 포트)의 구현들. 봇의 나머지 코드는 포트만 안다.
// 구현을 core가 아니라 봇에 둔 이유: SDK(@anthropic-ai/sdk)·로컬 모델 호출은 봇만 쓰고, core는 브라우저에서도 불러서 무거운 의존을 피한다.
// 서비스에서 BYOK·서비스 키 과금을 하려면 LlmConfig만 가족별로 다르게 만들어 createLlmAdapter에 넘기면 된다.
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_OLLAMA_KEEP_ALIVE, DEFAULT_OLLAMA_NUM_CTX, DEFAULT_OLLAMA_TIMEOUT_MS, type LlmAdapter, type LlmConfig, type LlmRequest, type OllamaKeepAlive } from "@hsh/core";
import { z } from "zod";

/** 응답에서 첫 JSON 객체를 꺼낸다 (모델이 앞뒤에 말을 붙여도 견딘다) */
export function extractJson(text: string): unknown {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error(`JSON 응답이 아닙니다: ${text.slice(0, 120)}`);
  return JSON.parse(text.slice(s, e + 1));
}

const ollamaResponse = z.object({ message: z.object({ content: z.string() }), prompt_eval_count: z.number().optional() });

export interface OllamaOptions {
  timeoutMs?: number;
  numCtx?: number;
  keepAlive?: OllamaKeepAlive;
}

/** 선택적으로 읽는 마지막 호출 정보(토큰 수). 모르는 어댑터는 없다 */
export interface LlmUsage {
  /** Ollama prompt_eval_count: 프롬프트 토큰 수(받았을 때만) */
  promptTokens?: number;
  numCtx?: number;
}
export interface ReportsUsage {
  lastUsage?: LlmUsage;
}

export class OllamaClient implements LlmAdapter, ReportsUsage {
  lastUsage?: LlmUsage;
  readonly name: string;
  private readonly timeoutMs: number;
  private readonly numCtx: number;
  private readonly keepAlive: OllamaKeepAlive;
  constructor(
    private readonly baseUrl = "http://localhost:11434",
    private readonly model = "qwen3:8b",
    opts: OllamaOptions = {},
  ) {
    this.name = `ollama:${model}`;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
    this.numCtx = opts.numCtx ?? DEFAULT_OLLAMA_NUM_CTX;
    this.keepAlive = opts.keepAlive ?? DEFAULT_OLLAMA_KEEP_ALIVE;
  }

  async json({ system, user, schema }: LlmRequest): Promise<unknown> {
    this.lastUsage = undefined;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        keep_alive: this.keepAlive,
        format: schema,
        options: { temperature: 0, num_ctx: this.numCtx },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = ollamaResponse.safeParse(await res.json());
    if (!data.success) throw new Error("Ollama 응답 형식이 올바르지 않아요");
    this.lastUsage = { promptTokens: data.data.prompt_eval_count, numCtx: this.numCtx };
    return extractJson(data.data.message.content);
  }
}

export class AnthropicClient implements LlmAdapter {
  readonly name: string;
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    private readonly model = "claude-haiku-5-5",
    private readonly timeoutMs = 30_000,
  ) {
    this.name = `anthropic:${model}`;
    this.client = new Anthropic({ apiKey });
  }

  async json({ system, user, schema }: LlmRequest): Promise<unknown> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: `${system}\n\n응답은 다음 JSON 스키마를 따르는 JSON 객체 하나만 출력한다:\n${JSON.stringify(schema)}`,
      messages: [{ role: "user", content: user }],
    }, { timeout: this.timeoutMs, maxRetries: 1 });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return extractJson(text);
  }
}

export function createLlmAdapter(cfg: LlmConfig): LlmAdapter {
  if (cfg.provider === "anthropic") return new AnthropicClient(cfg.apiKey, cfg.model || undefined);
  return new OllamaClient(cfg.baseUrl || undefined, cfg.model || undefined, { timeoutMs: cfg.timeoutMs, numCtx: cfg.numCtx, keepAlive: cfg.keepAlive });
}
