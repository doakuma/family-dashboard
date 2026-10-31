// 날짜 질문 모음을 실제 LLM으로 채점한다. 위키는 항상 fixtures/sample-wiki를 읽기 전용으로 연다(재현성).
//   pnpm --filter @hsh/bot eval:dates
//   pnpm --filter @hsh/bot eval:dates --only 일요일      (문장·id·태그에 문자열이 든 문항만)
//   pnpm --filter @hsh/bot eval:dates --json              (보고서를 JSON으로)
//   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @hsh/bot eval:dates
import { DEFAULT_FAMILY_ID } from "@hsh/core";
import { EnvConfigProvider, FsWikiRepository } from "@hsh/core/node";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLlmAdapter } from "../llm/client";
import { parseCases } from "./date-cases";
import { formatReport, runDateEval } from "./date-eval";

const args = process.argv.slice(2);
const json = args.includes("--json");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
if (onlyIdx >= 0 && !only) {
  console.error("사용법: pnpm --filter @hsh/bot eval:dates [--only <문자열>] [--json]");
  process.exit(1);
}

const dataPath = fileURLToPath(new URL("../../eval/date-questions.json", import.meta.url));
const wikiRoot = fileURLToPath(new URL("../../../../fixtures/sample-wiki", import.meta.url));
const all = parseCases(JSON.parse(readFileSync(dataPath, "utf8")));
const cases = only ? all.filter((c) => [c.id, c.text, ...c.tags].some((s) => s.includes(only))) : all;
if (!cases.length) {
  console.error(`--only "${only}"에 맞는 문항이 없어요.`);
  process.exit(1);
}

const config = new EnvConfigProvider();
const llm = createLlmAdapter(config.get("llm"));
const repo = new FsWikiRepository({ root: wikiRoot, readOnly: true, familyId: DEFAULT_FAMILY_ID });
const wiki = await repo.read(DEFAULT_FAMILY_ID);

if (!json) console.error(`[${llm.name}] ${cases.length}문항 채점 시작 (위키: fixtures/sample-wiki)`);
const report = await runDateEval(cases, llm, wiki, {
  onResult: (r) => {
    if (!json) console.error(`${r.rawOk && r.finalOk ? "ok  " : "FAIL"} ${r.id} ${r.ms}ms ${r.text}`);
  },
});
console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
