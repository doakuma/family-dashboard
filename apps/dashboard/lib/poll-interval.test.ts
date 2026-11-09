import { describe, expect, it } from "vitest";
import { DASHBOARD_POLL_MS, pollIntervalMs, SETUP_POLL_MS } from "./poll-interval";

describe("pollIntervalMs", () => {
  it("세팅 화면은 짧게, 대시보드는 60초", () => {
    expect(pollIntervalMs(true)).toBe(SETUP_POLL_MS);
    expect(pollIntervalMs(false)).toBe(DASHBOARD_POLL_MS);
    expect(SETUP_POLL_MS).toBeLessThanOrEqual(5_000);
    expect(DASHBOARD_POLL_MS).toBe(60_000);
  });
});
