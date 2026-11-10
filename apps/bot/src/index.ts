// 슬랙 봇 진입점 (Socket Mode). #가족 채널과 DM의 글을 대화 흐름(flow/conversation.ts)으로 넘긴다.
// 설정은 ConfigProvider, 봇 토큰은 InstallationStore로만 받는다(process.env 직접 참조 없음 - 결정 0003).
import { EnvConfigProvider, FsConnectCodeStore, FsSetupNoticeStore, FsWikiRepository } from "@hsh/core/node";
import { App, LogLevel, webApi } from "@slack/bolt";
import { startCalendarSync } from "./calendar/setup";
import { withCalendarKick } from "./calendar/hook";
import { AttemptLimiter, ConnectHandler } from "./connect/handler";
import { Conversation } from "./flow/conversation";
import { PendingStore } from "./flow/pending";
import { createLlmAdapter } from "./llm/client";
import { EnvInstallationStore, authorizeWith } from "./slack/installation";
import { ACTION_PATTERN, SlackUi, toActionInput, toConversationMessage } from "./slack/messenger";
import { checkBotToken, type WhoAmI } from "./slack/startup";
import { SettingsCommandHandler, isSettingsPendingId } from "./settings/handler";
import { SettingsPendingStore } from "./settings/pending";
import { slackWelcomePoster, WELCOME_CLIENT_OPTIONS } from "./welcome/slack";
import { WelcomeWorker } from "./welcome/worker";

const config = new EnvConfigProvider();
const { botToken, appToken, familyChannel } = config.get("slack");

if (!botToken || !appToken) {
  console.error("[bot] SLACK_BOT_TOKEN, SLACK_APP_TOKEN이 필요합니다. .env.example을 참고하세요.");
  process.exit(1);
}
const wikiRoot = config.get("wikiRepoPath");
if (!wikiRoot) {
  console.error("[bot] WIKI_REPO_PATH(가족 위키 레포 경로)가 필요합니다.");
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

const familyId = config.get("familyId");
const fsWiki = new FsWikiRepository({ root: wikiRoot, familyId, author: "slack" });
// 구글 캘린더 복사(위키 -> 구글 단방향, 결정 0012). 설정이 없으면 꺼짐. 일정이 저장되면 깨우고, 실패해도 위키 쓰기·대화는 성공으로 둔다
let calendarKick: () => void = () => {};
const wiki = withCalendarKick(fsWiki, () => calendarKick());
const llm = createLlmAdapter(config.get("llm"));
// 확인 버튼을 기다리는 요청은 이벤트마다 만드는 Conversation이 함께 쓴다
const pending = new PendingStore();

if (!familyChannel) console.warn("[bot] SLACK_FAMILY_CHANNEL(가족 채널 id, C로 시작)이 없어 DM만 듣습니다.");
else if (!/^[CG][A-Z0-9]+$/.test(familyChannel)) console.warn(`[bot] SLACK_FAMILY_CHANNEL은 채널 이름이 아니라 id(C로 시작)여야 해요: ${familyChannel}`);

const installationStore = new EnvInstallationStore(config);
// 주의: app.client에는 기본 토큰이 없다. authorize가 이벤트마다 토큰을 넣어 주는 컨텍스트(client·say 등)로만 Slack을 부른다.
const app = new App({
  authorize: authorizeWith(installationStore, whoami),
  appToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

/** 이벤트의 client(토큰이 들어 있음)로 말하는 대화 흐름 */
const conversationWith = (client: webApi.WebClient) => new Conversation({ wiki, llm, familyId, pending, ui: new SlackUi(async () => client) });

// 설정 변경 고정 명령("하늘이 색 초록으로 바꿔줘")도 LLM 앞에서 가로챈다. 확인을 기다리는 요청은 이벤트마다 만드는 처리기가 함께 쓴다
const settingsPending = new SettingsPendingStore();
const settingsWith = (client: webApi.WebClient) => new SettingsCommandHandler({ wiki, ui: new SlackUi(async () => client), familyId, pending: settingsPending });

// 슬랙 연결 코드(`연결 482913`)는 대화 흐름(LLM)보다 먼저 가로챈다. 코드를 LLM에 보내지 않고, 채널에 올라온 코드는 여기서 지운다
const connectLimiter = new AttemptLimiter(Date.now);
const connectStore = new FsConnectCodeStore({ dir: config.get("stateDir") });
const connectWith = (client: webApi.WebClient) => new ConnectHandler({ store: connectStore, ui: new SlackUi(async () => client), limiter: connectLimiter });

app.message(/^ping$/, async ({ say }) => {
  await say("pong 🏠");
});

app.message(async ({ message, client, context }) => {
  const m = toConversationMessage(message, { familyChannel, botUserId: context.botUserId });
  if (!m || m.text === "ping") return;
  if (await connectWith(client).tryHandle(m)) return;
  if (await settingsWith(client).tryHandle(m)) return;
  await conversationWith(client).handleMessage(m);
});

// 버튼은 3초 안에 ack해야 하므로 먼저 ack하고, 위키 쓰기는 그 뒤에 한다(카드는 "넣는 중…"으로 바뀐다)
app.action(ACTION_PATTERN, async ({ ack, body, client }) => {
  await ack();
  const a = toActionInput(body);
  if (!a) return;
  // 설정 변경 확인 버튼은 id 머리말로 가려 설정 처리기로, 나머지는 대화 흐름으로
  if (isSettingsPendingId(a.pendingId)) await settingsWith(client).handleAction(a);
  else await conversationWith(client).handleAction(a);
});

// 캘린더 동기화는 봇 시작을 막거나 죽이지 않는다
try {
  const calendar = await startCalendarSync({ config, wiki: fsWiki, files: fsWiki.files, familyId });
  if (calendar) calendarKick = calendar.kick;
} catch (e) {
  console.warn(`[bot] 구글 캘린더 복사를 시작하지 못했어요: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
}

// 세팅 완료 알림(대시보드가 상자에 넣음)을 확인해 #가족 채널에 환영 메시지를 한 번 올린다. 설정이 잘못돼도 봇의 나머지는 계속 돈다.
try {
  const welcome = new WelcomeWorker({
    store: new FsSetupNoticeStore({ dir: config.get("stateDir") }),
    readState: (id) => wiki.read(id),
    post: slackWelcomePoster(installationStore, (token) => new webApi.WebClient(token, WELCOME_CLIENT_OPTIONS)),
    channel: familyChannel,
  });
  welcome.start();
} catch (e) {
  console.warn(`[bot] 세팅 완료 환영 메시지 처리기를 시작하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
}

await app.start();
console.log("[bot] Socket Mode로 연결했습니다.");
