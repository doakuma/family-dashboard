#!/usr/bin/env node
// PreToolUse 훅: 에이전트가 위키(family-wiki)를 직접 고치거나 지우지 못하게 막는다.
// 위키 쓰기는 오직 WikiRepository.apply(코드)로만 한다. 테스트 픽스처(fixtures/)는 예외.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const tool = input.tool_name ?? "";
const ti = input.tool_input ?? {};
const wikiPath = process.env.WIKI_REPO_PATH;

const touchesWiki = (s = "") =>
  /(^|[\\/\s"'])family-wiki([\\/\s"']|$)/.test(s) || (wikiPath ? s.includes(wikiPath) : false);

const block = (why) => {
  process.stderr.write(`위키 보호: ${why}\n위키는 WikiRepository.apply로만 바꿉니다. 필요하면 오너에게 요청하세요.\n`);
  process.exit(2);
};

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool) && touchesWiki(ti.file_path)) {
  block(`${ti.file_path} 직접 수정 금지`);
}

if (tool === "Bash") {
  const cmd = String(ti.command ?? "");
  if (touchesWiki(cmd) && /\b(rm|mv|rmdir|truncate|tee|sed\s+-i|git\s+(push|reset|clean|checkout|rebase|commit))\b|>/.test(cmd)) {
    block(`위키 경로를 바꾸는 명령 금지: ${cmd}`);
  }
}
