import { describe, expect, it } from "vitest";
import { EXIT_CONFIG, EXIT_RETRY, checkBotToken } from "./startup";

const slackErr = (error: string) => Object.assign(new Error(`An API error occurred: ${error}`), { data: { ok: false, error } });

describe("checkBotToken", () => {
  it("성공하면 봇 id를 돌려준다", async () => {
    expect(await checkBotToken(async () => ({ botId: "B1", botUserId: "U1" }), "xoxb-1")).toEqual({ ok: true, who: { botId: "B1", botUserId: "U1" } });
  });
  it.each(["invalid_auth", "token_revoked", "account_inactive"])("영구 오류(%s)는 재시작하지 않는 코드", async (code) => {
    const r = await checkBotToken(async () => { throw slackErr(code); }, "xoxb-1");
    expect(r).toMatchObject({ ok: false, exitCode: EXIT_CONFIG });
    expect(JSON.stringify(r)).toContain(code);
  });
  it("네트워크 같은 일시 오류는 재시도 코드, 토큰 값은 메시지에 없다", async () => {
    const r = await checkBotToken(async () => { throw new Error("getaddrinfo ENOTFOUND slack.com"); }, "xoxb-secret");
    expect(r).toMatchObject({ ok: false, exitCode: EXIT_RETRY });
    expect(JSON.stringify(r)).not.toContain("xoxb-secret");
  });
  it("모르는 Slack 오류 코드도 재시도 쪽", async () => {
    expect(await checkBotToken(async () => { throw slackErr("ratelimited"); }, "t")).toMatchObject({ exitCode: EXIT_RETRY });
  });
});
