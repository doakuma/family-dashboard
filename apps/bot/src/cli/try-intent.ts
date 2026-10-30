// 슬랙 없이 의도 추출을 시험한다. 위키에는 쓰지 않는다.
//   pnpm --filter @hsh/bot try "다음 주 화요일 3시 하늘 치과"
//   pnpm --filter @hsh/bot try "이번 주 토요일 뭐 있어?" --now 2026-10-29T09:00   (질문이면 위키를 읽어 답만 출력)
//   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @hsh/bot try "우유랑 사과 사야 돼"
import type { LlmAdapter } from "@hsh/core";
import { EnvConfigProvider, FsWikiRepository } from "@hsh/core/node";
import { fileURLToPath } from "node:url";
import { createLlmAdapter } from "../llm/client";
import { answerQuestion } from "../intent/answer";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('사용법: pnpm --filter @hsh/bot try "메시지" [--as U00MOM] [--now 2026-10-29T09:00] [--offline]');
  process.exit(1);
}

const config = new EnvConfigProvider();
const root = config.get("wikiRepoPath") ?? fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url));
const nowIdx = process.argv.indexOf("--now");
const nowArg = nowIdx > 0 ? process.argv[nowIdx + 1] : undefined;
// --now는 서울 시각으로 읽는다. 시간대 표기(Z, +09:00)가 없으면 +09:00을 붙인다.
const now = nowArg ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(nowArg) ? nowArg : `${nowArg.length <= 10 ? `${nowArg}T12:00` : nowArg}+09:00`) : undefined;
if (now && Number.isNaN(now.getTime())) {
  console.error("--now 형식: 2026-10-29 또는 2026-10-29T09:00");
  process.exit(1);
}
const asIdx = process.argv.indexOf("--as");
const sender = asIdx > 0 ? process.argv[asIdx + 1] : "U00MOM";
const message = text.replace(/--as\s+\S+/, "").replace(/--now\s+\S+/, "").replace(/--offline/, "").trim();

const wiki = await new FsWikiRepository({ root, readOnly: true, familyId: config.get("familyId") }).read(config.get("familyId"));
// --offline: LLM 없이 "무조건 질문"으로 보고 코드 쪽(날짜 파서·위키 답 조립)만 시험한다. 네트워크·비용 없음.
const offline = process.argv.includes("--offline");
const llm: LlmAdapter = offline ? { name: "offline(항상 question)", json: async () => ({ intent: "question" }) } : createLlmAdapter(config.get("llm"));
const t0 = Date.now();
const { intent, text: answer } = await answerQuestion({ text: message, senderSlackId: sender, now, ...wiki }, llm);
console.log(`[${llm.name}] ${Date.now() - t0}ms`);
if (intent.type === "question" || intent.type === "unknown") console.log(answer);
else console.log(JSON.stringify(intent, null, 2));
