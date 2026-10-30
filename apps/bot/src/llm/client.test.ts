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
    const a = createLlmAdapter({ provider: "anthropic", apiKey: "k" });
    expect(a).toBeInstanceOf(AnthropicClient);
    expect(a.name).toBe("anthropic:claude-haiku-5-5");
  });
});
