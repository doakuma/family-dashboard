// 슬랙 봇 진입점 (Socket Mode). 골격 단계: 연결 확인만 한다.
// 의도 추출·확인 버튼·위키 쓰기는 이후 할 일에서 붙인다.
// 설정은 ConfigProvider, 봇 토큰은 InstallationStore로만 받는다(process.env 직접 참조 없음 - 결정 0003).
import { EnvConfigProvider } from "@hsh/core/node";
import { App, LogLevel, webApi } from "@slack/bolt";
import { EnvInstallationStore, authorizeWith } from "./slack/installation";
import { checkBotToken, type WhoAmI } from "./slack/startup";

const config = new EnvConfigProvider();
const { botToken, appToken } = config.get("slack");

if (!botToken || !appToken) {
  console.error("[bot] SLACK_BOT_TOKEN, SLACK_APP_TOKEN이 필요합니다. .env.example을 참고하세요.");
  process.exit(1);
}

const whoami = async (token: string): Promise<WhoAmI> => {
  const r = await new webApi.WebClient(token).auth.test();
  return { botId: r.bot_id, botUserId: r.user_id };
};

// 시작 전에 토큰을 한 번 확인한다. 실패하면 원인을 로그로 남기고 끝낸다(종료 코드 판단은 slack/startup.ts).
const check = await checkBotToken(whoami, botToken);
if (!check.ok) {
  console.error(`[bot] ${check.message}`);
  process.exit(check.exitCode);
}

const installationStore = new EnvInstallationStore(config);
// 주의: app.client에는 기본 토큰이 없다. authorize가 이벤트마다 토큰을 넣어 주는 컨텍스트(client·say 등)로만 Slack을 부른다.
const app = new App({
  authorize: authorizeWith(installationStore, whoami),
  appToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

app.message("ping", async ({ say }) => {
  await say("pong 🏠");
});

await app.start();
console.log("[bot] Socket Mode로 연결했습니다.");
