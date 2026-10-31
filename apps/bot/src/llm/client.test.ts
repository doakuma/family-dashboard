import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicClient, OllamaClient, createLlmAdapter } from "./client";

const reply = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
const req = { system: "s", user: "u", schema: {} };

describe("OllamaClient 응답 검증", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 응답에서 JSON을 꺼낸다", async () => {
    reply({ message: { content: '{"intent":"question"}' } });
    await expect(new OllamaClient().json(req)).resolves.toEqual({ intent: "question" });
  });

  it("num_ctx·keep_alive를 요청에 싣는다(기본 8192 / 30m, 설정으로 바꿈)", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 });
    }));
    await new OllamaClient().json(req);
    await new OllamaClient(undefined, undefined, { numCtx: 4096, keepAlive: "1h" }).json(req);
    expect(bodies[0]).toMatchObject({ keep_alive: "30m", options: { temperature: 0, num_ctx: 8192 } });
    expect(bodies[1]).toMatchObject({ keep_alive: "1h", options: { num_ctx: 4096 } });
  });

  it("형식이 다른 응답은 거부한다", async () => {
    reply({ message: { content: 42 } });
    await expect(new OllamaClient().json(req)).rejects.toThrow(/응답 형식/);
    reply({ error: "x" });
    await expect(new OllamaClient().json(req)).rejects.toThrow(/응답 형식/);
  });
});

describe("createLlmAdapter", () => {
  it("설정의 provider로 구현을 고른다", () => {
    expect(createLlmAdapter({ provider: "ollama" }).name).toBe("ollama:qwen3:8b");
    expect(createLlmAdapter({ provider: "ollama", model: "x" }).name).toBe("ollama:x");
    expect(createLlmAdapter({ provider: "ollama", timeoutMs: 1000 }).name).toBe("ollama:qwen3:8b");
    const a = createLlmAdapter({ provider: "anthropic", apiKey: "k" });
    expect(a).toBeInstanceOf(AnthropicClient);
    expect(a.name).toBe("anthropic:claude-haiku-5-5");
  });
});
