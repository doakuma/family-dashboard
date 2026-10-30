// 슬랙 없이 의도 추출을 시험한다. 위키에는 쓰지 않는다.
//   pnpm --filter @hsh/bot try "다음 주 화요일 3시 하늘 치과"
//   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @hsh/bot try "우유랑 사과 사야 돼"
import { EnvConfigProvider, FsWikiRepository } from "@hsh/core/node";
import { fileURLToPath } from "node:url";
import { createLlmAdapter } from "../llm/client";
import { extractIntent } from "../intent/extract";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('사용법: pnpm --filter @hsh/bot try "메시지" [--as U00MOM]');
  process.exit(1);
}

const config = new EnvConfigProvider();
const root = config.get("wikiRepoPath") ?? fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url));
const asIdx = process.argv.indexOf("--as");
const sender = asIdx > 0 ? process.argv[asIdx + 1] : "U00MOM";
const message = text.replace(/--as\s+\S+/, "").trim();

const wiki = await new FsWikiRepository({ root, push: false, familyId: config.get("familyId") }).read(config.get("familyId"));
const llm = createLlmAdapter(config.get("llm"));
const t0 = Date.now();
const intent = await extractIntent({ text: message, senderSlackId: sender, ...wiki }, llm);
console.log(`[${llm.name}] ${Date.now() - t0}ms`);
console.log(JSON.stringify(intent, null, 2));
