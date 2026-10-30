import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FsWikiRepository } from "./node/fs-wiki";
import { apiStateSchema } from "./schema";
import { needsSetup } from "./types";

describe("apiStateSchema (/api/state 응답 검증)", async () => {
  const wiki = new FsWikiRepository({ root: resolve(import.meta.dirname, "../../../fixtures/sample-wiki"), readOnly: true });
  const state = await wiki.read();
  const body = { ...state, weather: [], updatedAt: "2026-11-03T01:00:00Z", needsSetup: needsSetup(state) };

  it("예시 위키 상태는 통과한다", () => {
    expect(apiStateSchema.parse(JSON.parse(JSON.stringify(body)))).toMatchObject({ needsSetup: false });
  });

  it("needsSetup이 빠졌거나 형식이 다르면 거부한다", () => {
    expect(apiStateSchema.safeParse({ ...body, needsSetup: undefined }).success).toBe(false);
    expect(apiStateSchema.safeParse({ ...body, events: [{ id: "x" }] }).success).toBe(false);
    expect(apiStateSchema.safeParse({ ...body, updatedAt: "어제" }).success).toBe(false);
    expect(apiStateSchema.safeParse("<html>").success).toBe(false);
  });
});
