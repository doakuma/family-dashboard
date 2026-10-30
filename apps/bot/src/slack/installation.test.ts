import { describe, expect, it, vi } from "vitest";
import { EnvInstallationStore, authorizeWith } from "./installation";

const cfg = (botToken?: string) => ({ get: ((k: string) => (k === "slack" ? { botToken } : undefined)) as never });

describe("EnvInstallationStore", () => {
  it("워크스페이스와 무관하게 설정의 봇 토큰을 돌려준다", async () => {
    const s = new EnvInstallationStore(cfg("xoxb-1"));
    const a = await s.fetchInstallation({ teamId: "T1", enterpriseId: undefined, isEnterpriseInstall: false });
    const b = await s.fetchInstallation({ teamId: "T2", enterpriseId: undefined, isEnterpriseInstall: false });
    expect(a.bot?.token).toBe("xoxb-1");
    expect(b.bot?.token).toBe("xoxb-1");
    expect(a.team?.id).toBe("T1");
  });
  it("토큰이 없으면 던진다", async () => {
    await expect(new EnvInstallationStore(cfg()).fetchInstallation({ teamId: "T1", enterpriseId: undefined, isEnterpriseInstall: false })).rejects.toThrow(/SLACK_BOT_TOKEN/);
  });
});

describe("authorizeWith", () => {
  it("저장소에서 토큰을 받아 Bolt authorize 결과로 바꾸고, 봇 id 조회는 토큰별로 한 번만 한다", async () => {
    const whoami = vi.fn(async () => ({ botId: "B1", botUserId: "U1" }));
    const authorize = authorizeWith(new EnvInstallationStore(cfg("xoxb-1")), whoami);
    const src = { teamId: "T1", enterpriseId: undefined, isEnterpriseInstall: false } as const;
    expect(await authorize(src)).toMatchObject({ botToken: "xoxb-1", botId: "B1", botUserId: "U1", teamId: "T1" });
    await authorize(src);
    expect(whoami).toHaveBeenCalledTimes(1);
  });
});
