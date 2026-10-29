#!/usr/bin/env node
// PostToolUse(Edit|Write) 훅: 바뀐 파일이 속한 패키지의 tsc --noEmit + 그 파일 eslint.
// 실패하면 exit 2로 에이전트에게 오류를 되돌려 보낸다.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (!file || !/\.(ts|tsx|mts|mjs)$/.test(file) || !file.startsWith(root)) process.exit(0);

// 가장 가까운 tsconfig.json이 있는 패키지를 찾는다.
let dir = dirname(file);
while (dir.startsWith(root) && !existsSync(join(dir, "tsconfig.json"))) dir = dirname(dir);

const errors = [];
const run = (cmd, args, cwd) => {
  try {
    execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    errors.push(`$ ${cmd} ${args.join(" ")}\n${e.stdout ?? ""}${e.stderr ?? ""}`.trim());
  }
};

if (dir.startsWith(root) && dir !== root) run("pnpm", ["exec", "tsc", "--noEmit", "-p", "."], dir);
run("pnpm", ["exec", "eslint", relative(root, file)], root);

if (errors.length) {
  process.stderr.write(`타입 체크/린트 실패 — 고친 뒤 다시 진행하세요.\n\n${errors.join("\n\n")}\n`);
  process.exit(2);
}
