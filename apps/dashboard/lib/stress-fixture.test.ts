import { FsWikiRepository } from "@hsh/core/node";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// fixtures/stress-wiki가 e2e가 기대하는 모양(80자 제목, 하루 14건)을 유지하는지: 형식이 깨져 조용히 사라지는 줄이 없게.
describe("stress-wiki 픽스처", () => {
  it("경고 없이 읽히고, 80자 제목과 오늘 14건이 있다", async () => {
    const repo = new FsWikiRepository({ root: join(import.meta.dirname, "../../../fixtures/stress-wiki"), readOnly: true });
    const s = await repo.read();
    expect(s.warnings).toEqual([]);
    expect(s.events.filter((e) => e.date === "2026-11-03")).toHaveLength(14);
    expect(Math.max(...s.events.map((e) => e.title.length))).toBe(80);
    expect(s.anniversaries.some((a) => a.title.length === 80)).toBe(true);
    expect(s.tasks.filter((t) => t.list === "shopping")).toHaveLength(8);
  });
});
