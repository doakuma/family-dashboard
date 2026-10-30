import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "./client";

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
