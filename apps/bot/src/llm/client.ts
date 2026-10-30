// LLM 호출부. 의도 추출은 "시스템 프롬프트 + 메시지 → JSON 한 개"만 필요하므로 인터페이스를 이만큼으로 좁힌다.
// LLM_PROVIDER=ollama(로컬) | anthropic 으로 고른다.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export interface LlmRequest {
  system: string;
  user: string;
  /** 응답 JSON 스키마 (Ollama structured output에 그대로 전달) */
  schema: Record<string, unknown>;
}

export interface LlmClient {
  readonly name: string;
  /** 응답 본문을 JSON으로 파싱한 값. 검증은 호출하는 쪽에서 한다. */
  json(req: LlmRequest): Promise<unknown>;
}

/** 응답에서 첫 JSON 객체를 꺼낸다 (모델이 앞뒤에 말을 붙여도 견딘다) */
export function extractJson(text: string): unknown {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error(`JSON 응답이 아닙니다: ${text.slice(0, 120)}`);
  return JSON.parse(text.slice(s, e + 1));
}

const ollamaResponse = z.object({ message: z.object({ content: z.string() }) });

export class OllamaClient implements LlmClient {
  readonly name: string;
  constructor(
    private readonly baseUrl = "http://localhost:11434",
    private readonly model = "qwen3:8b",
    private readonly timeoutMs = 60_000,
  ) {
    this.name = `ollama:${model}`;
  }

  async json({ system, user, schema }: LlmRequest): Promise<unknown> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        format: schema,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = ollamaResponse.safeParse(await res.json());
    if (!data.success) throw new Error("Ollama 응답 형식이 올바르지 않아요");
    return extractJson(data.data.message.content);
  }
}

export class AnthropicClient implements LlmClient {
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

export function createLlmClient(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const provider = (env.LLM_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic에는 ANTHROPIC_API_KEY가 필요합니다");
    return new AnthropicClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || undefined);
  }
  if (provider === "ollama") return new OllamaClient(env.OLLAMA_BASE_URL || undefined, env.OLLAMA_MODEL || undefined);
  throw new Error(`알 수 없는 LLM_PROVIDER: ${provider}`);
}
