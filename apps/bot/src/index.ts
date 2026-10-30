// 슬랙 봇 진입점 (Socket Mode). 골격 단계: 연결 확인만 한다.
// 의도 추출·확인 버튼·위키 쓰기는 이후 할 일에서 붙인다.
// 설정은 ConfigProvider, 봇 토큰은 InstallationStore로만 받는다(process.env 직접 참조 없음 - 결정 0003).
import { EnvConfigProvider } from "@hsh/core/node";
import { App, LogLevel, webApi } from "@slack/bolt";
import { EnvInstallationStore, authorizeWith } from "./slack/installation";

const config = new EnvConfigProvider();
const { botToken, appToken } = config.get("slack");

if (!botToken || !appToken) {
  console.error("[bot] SLACK_BOT_TOKEN, SLACK_APP_TOKEN이 필요합니다. .env.example을 참고하세요.");
  process.exit(1);
}

const installationStore = new EnvInstallationStore(config);
const app = new App({
  authorize: authorizeWith(installationStore, async (token) => {
    const r = await new webApi.WebClient(token).auth.test();
    return { botId: r.bot_id, botUserId: r.user_id };
  }),
  appToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

app.message("ping", async ({ say }) => {
  await say("pong 🏠");
});

await app.start();
console.log("[bot] Socket Mode로 연결했습니다.");
