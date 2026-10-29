// 슬랙 봇 진입점 (Socket Mode). 골격 단계: 연결 확인만 한다.
// 의도 추출·확인 버튼·위키 쓰기는 이후 할 일에서 붙인다.
import { App, LogLevel } from "@slack/bolt";

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = process.env;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error("[bot] SLACK_BOT_TOKEN, SLACK_APP_TOKEN이 필요합니다. .env.example을 참고하세요.");
  process.exit(1);
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

app.message("ping", async ({ say }) => {
  await say("pong 🏠");
});

await app.start();
console.log("[bot] Socket Mode로 연결했습니다.");
