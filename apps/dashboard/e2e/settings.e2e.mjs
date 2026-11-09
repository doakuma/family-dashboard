// /settings E2E (pnpm check에는 포함되지 않음). 사전: `pnpm --filter @hsh/dashboard build`, Playwright 설치, tsx(봇의 DM 연결 흉내용).
//   node apps/dashboard/e2e/settings.e2e.mjs
// 세팅이 끝난 임시 위키(git, 원격 없음) + 임시 상태 폴더 + 임시 PIN 해시로 운영 모드 서버를 띄운다. .env는 읽지 않는다.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright"));
}

const root = resolve(import.meta.dirname, "..");
const PORT = 3221;
const BASE = `http://localhost:${PORT}`;
const PIN = "4821";

const wiki = mkdtempSync(join(tmpdir(), "hsh-settings-e2e-wiki-"));
const git = (...args) => execFileSync("git", args, { cwd: wiki, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
execFileSync("git", ["init", "-q", "-b", "main", wiki]);
git("config", "user.email", "e2e@example.com");
git("config", "user.name", "e2e");
mkdirSync(join(wiki, "members"));
const MOM = "---\nid: mom\nname: 엄마\nrole: guardian\ncolor: coral\nslack: U0MOM123\n---\n";
const HANEUL = "---\nid: haneul\nname: 하늘\nrole: child\ncolor: blue\nnickname: 하늘이\n---\n\n## 메모\n공룡을 좋아해요\n";
writeFileSync(join(wiki, "config.md"), "---\nfamilyName: 햇살네\ntimezone: Asia/Seoul\nregion: 서울특별시 마포구\nkmaNx: 59\nkmaNy: 127\nkmaMidLandRegId: 11B00000\nkmaMidTaRegId: 11B10101\nfamilyColor: gray\nsetupCompletedAt: 2026-10-30T20:00:00+09:00\n---\n");
writeFileSync(join(wiki, "members/mom.md"), MOM);
writeFileSync(join(wiki, "members/haneul.md"), HANEUL);
writeFileSync(join(wiki, "tasks.md"), "## 장보기\n");
git("add", ".");
git("commit", "-qm", "seed");

const hashLine = execFileSync("node", ["scripts/pin-hash.ts"], { cwd: root, input: `${PIN}\n`, stdio: ["pipe", "pipe", "ignore"] }).toString().trim();
const stateDir = mkdtempSync(join(tmpdir(), "hsh-settings-e2e-state-"));
const env = { ...process.env, PORT: String(PORT), WIKI_REPO_PATH: wiki, HSH_STATE_DIR: stateDir, DASHBOARD_BASE_URL: BASE, ADMIN_PIN_HASH: hashLine.slice("ADMIN_PIN_HASH=".length), NODE_ENV: undefined };
const server = spawn("node", ["server.ts"], { cwd: root, env, stdio: "ignore" });
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`서버가 안 떠요: ${url}`);
}
let n = 0;
const ok = (msg) => console.log(`ok ${++n} ${msg}`);
const read = (rel) => readFileSync(join(wiki, rel), "utf8");

/** 보이는 입력·버튼의 높이가 48px 이상인지, 가로로 넘치지 않는지 */
async function assertLayout(page, where) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("input:not([type=radio]):not([type=checkbox]), select, button, summary")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 47.5) out.push(`${el.tagName} ${el.id || el.textContent?.slice(0, 12)} h=${r.height}`);
    }
    for (const el of document.querySelectorAll("label")) {
      const sp = el.querySelector("span");
      if (!sp || !el.querySelector("input[type=radio]")) continue;
      const r = sp.getBoundingClientRect();
      if (r.height < 47.5) out.push(`radio ${el.textContent?.slice(0, 8)} h=${r.height}`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`가로 넘침 ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    return out;
  });
  assert.deepEqual(bad, [], `${where}: 터치 48px/가로 넘침`);
}

const browser = await pw.chromium.launch();
try {
  await waitFor(`${BASE}/api/state`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const post = (data, headers = {}) => ctx.request.post(`${BASE}/api/settings`, { data, headers: { origin: BASE, ...headers }, maxRedirects: 0 });

  // ---- 세션 없이는 화면도 API도 닫혀 있다 ----
  await page.goto(`${BASE}/settings`);
  await page.getByLabel("관리자 PIN").waitFor();
  assert.equal((await post({ kind: "member.color", id: "haneul", color: "green" })).status(), 401);
  assert.equal(read("members/haneul.md"), HANEUL);
  ok("PIN 전에는 PIN 화면, API는 401, 위키 그대로");

  // ---- 틀린 PIN / 맞는 PIN ----
  await page.getByLabel("관리자 PIN").fill("0000");
  await page.getByRole("button", { name: "확인" }).click();
  await page.getByRole("alert").filter({ hasText: "PIN이 맞지 않아요" }).waitFor();
  await page.getByLabel("관리자 PIN").fill(PIN);
  await page.getByRole("button", { name: "확인" }).click();
  await page.getByRole("heading", { name: "설정", level: 1 }).waitFor();
  for (const h of ["구성원", "슬랙 연결", "지역"]) await page.getByRole("heading", { name: h, level: 2 }).waitFor();
  assert.equal(await page.locator("[data-surface=phone]").count(), 1);
  await assertLayout(page, "처음 화면");
  ok("PIN 로그인 -> 설정 화면(구성원·슬랙 연결·지역), 터치 48px");

  // ---- 출처가 다른 요청은 403 ----
  assert.equal((await post({ kind: "member.color", id: "haneul", color: "green" }, { origin: "http://evil.example" })).status(), 403);
  assert.equal((await post({ kind: "member.color", id: "haneul", color: "green", slackId: "U1" })).status(), 422);
  assert.equal((await post({ kind: "member.add", name: "x", role: "child", color: "gray" })).status(), 422);
  ok("다른 출처 403, 여분 필드·목록 밖 색 422");

  // ---- 색 바꾸기 ----
  const before = git("rev-list", "--count", "HEAD");
  await page.getByRole("button", { name: "하늘 색 바꾸기" }).click();
  await page.getByRole("radiogroup", { name: "하늘 님의 색" }).waitFor();
  await assertLayout(page, "색 고르기");
  await page.getByRole("radiogroup", { name: "하늘 님의 색" }).locator("label").filter({ hasText: /^초록$/ }).click();
  await page.getByRole("button", { name: "하늘 색 저장" }).click();
  await page.getByRole("status").filter({ hasText: "하늘 님의 색을 초록(으)로 바꿨어요" }).waitFor();
  assert.equal(read("members/haneul.md"), HANEUL.replace("color: blue", "color: green"), "색 줄만 바뀌고 별명·본문은 그대로");
  assert.equal(Number(git("rev-list", "--count", "HEAD")) - Number(before), 1);
  assert.equal(git("log", "-1", "--format=%s"), "[settings] 하늘 색: 파랑 → 초록");
  assert.equal(git("log", "-1", "--format=%an"), "settings");
  assert.match(read("log.md"), /\[settings\] 하늘 색: 파랑 → 초록 \(by settings\) #haneul/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-color-btn-haneul", "저장 뒤 포커스가 같은 구성원의 버튼으로");
  const state = await (await ctx.request.get(`${BASE}/api/state`)).json();
  assert.equal(state.members.find((m) => m.id === "haneul").color, "green", "태블릿 상태에도 반영");
  ok("색 바꾸기: 한 줄만 바뀌고 커밋 1개·log.md·aria-live·포커스");

  // ---- 구성원 추가 ----
  await page.getByRole("button", { name: /구성원 추가 \(2\/12\)/ }).click();
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByText("이름을 넣어 주세요").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "settings-add-name", "오류가 있으면 이름 칸으로 포커스");
  await page.getByLabel("이름").fill("할머니");
  await page.getByRole("radiogroup", { name: "역할" }).locator("label").filter({ hasText: /^보호자$/ }).click();
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "할머니 님을 추가했어요" }).waitFor();
  assert.match(read("members/member-1.md"), /^---\nid: member-1\nname: 할머니\nrole: guardian\ncolor: \w+\n---\n$/);
  assert.equal(git("log", "-1", "--format=%s").startsWith("[settings] 구성원 추가: 할머니"), true);
  await page.getByText("할머니", { exact: true }).first().waitFor();
  ok("구성원 추가(이름 오류 포커스, member-1 파일, 커밋)");

  // ---- 슬랙 재연결 ----
  const claim = (code, slackId) => {
    const r = spawnSync("tsx", [join(root, "e2e/connect-claim.ts"), stateDir, code, slackId], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`claim 도우미 실패(tsx 필요): ${r.stderr}`);
    return JSON.parse(r.stdout.trim());
  };
  await page.getByRole("button", { name: "하늘 연결 코드 받기" }).click();
  const codeEl = page.locator("[aria-label^='연결 코드 ']").first();
  await codeEl.waitFor();
  const code = (await codeEl.innerText()).trim();
  assert.match(code, /^\d{6}$/);
  assert.equal((await post({ kind: "slack.save", id: "haneul", code })).status(), 409, "DM 전에는 반영할 수 없다");
  assert.deepEqual(claim(code, "U0SKY999"), { ok: true });
  await page.getByText(/슬랙 계정이 확인됐어요/).waitFor({ timeout: 15_000 });
  await page.getByRole("status").filter({ hasText: "하늘 님이 슬랙에 연결됐어요" }).waitFor();
  assert.ok(!(await page.content()).includes("U0SKY999"), "슬랙 ID는 화면에 없다");
  assert.ok(!read("members/haneul.md").includes("slack:"), "반영 전에는 위키가 그대로");
  await page.getByRole("button", { name: "하늘 슬랙 연결 반영" }).click();
  await page.getByRole("status").filter({ hasText: "하늘 님을 슬랙 계정에 연결했어요" }).waitFor();
  assert.match(read("members/haneul.md"), /\nslack: U0SKY999\n/);
  assert.ok(read("members/haneul.md").includes("nickname: 하늘이"));
  assert.ok(!read("log.md").includes("U0SKY999") && !git("log", "-1", "--format=%B").includes("U0SKY999"), "슬랙 ID는 log·커밋에 없다");
  assert.equal(git("log", "-1", "--format=%s"), "[settings] 하늘 슬랙: 연결");
  assert.ok(!(await page.content()).includes("U0SKY999"));
  assert.ok(!JSON.stringify(await (await ctx.request.get(`${BASE}/api/state`)).json()).includes("U0SKY999"), "/api/state에도 슬랙 ID 없음");
  assert.equal((await post({ kind: "slack.save", id: "haneul", code })).status(), 409, "쓴 코드는 다시 쓸 수 없다");
  ok("슬랙 재연결: 코드 -> DM 흉내 -> 확인됨 -> 반영(ID는 화면·로그·상태 응답에 없음)");

  // 이미 다른 구성원에 연결된 계정은 거부
  await page.getByRole("button", { name: "엄마 다른 계정으로 다시 연결하기" }).click();
  const code2 = (await page.locator("[aria-label^='연결 코드 ']").first().innerText()).trim();
  assert.deepEqual(claim(code2, "U0SKY999"), { ok: true });
  await page.getByRole("button", { name: "엄마 슬랙 연결 반영" }).click();
  await page.getByRole("alert").filter({ hasText: "이미 '하늘'에 연결" }).waitFor();
  assert.ok(read("members/mom.md").includes("U0MOM123"), "거부되면 엄마 연결은 그대로");
  ok("같은 슬랙 계정을 다른 구성원에 반영하면 409 안내");

  // 연결 풀기(확인 단계)
  await page.getByRole("button", { name: "하늘 슬랙 연결 풀기" }).click();
  await page.getByText("풀면 하늘 님은").waitFor();
  await page.getByRole("button", { name: "그대로 두기" }).click();
  assert.ok(read("members/haneul.md").includes("slack:"));
  await page.getByRole("button", { name: "하늘 슬랙 연결 풀기" }).click();
  await page.getByRole("button", { name: "하늘 슬랙 연결 풀기 확정" }).click();
  await page.getByRole("status").filter({ hasText: "하늘 님의 슬랙 연결을 풀었어요" }).waitFor();
  assert.ok(!read("members/haneul.md").includes("slack:"));
  ok("연결 풀기: 확인 후 slack 줄만 삭제");

  // ---- 지역 ----
  await page.getByLabel("사는 지역").selectOption("seoul-gangnam");
  await page.getByRole("button", { name: "지역 저장" }).click();
  await page.getByRole("status").filter({ hasText: "지역을 서울특별시 강남구(으)로 바꿨어요" }).waitFor();
  assert.match(read("config.md"), /region: 서울특별시 강남구\nkmaNx: 61\nkmaNy: 126\n/);
  assert.ok(read("config.md").includes("setupCompletedAt: 2026-10-30T20:00:00+09:00"));
  await assertLayout(page, "저장 뒤 화면");
  ok("지역 변경: 격자·코드가 지역표대로 바뀌고 나머지는 그대로");

  // ---- 새로고침해도 서버 상태 ----
  await page.reload();
  await page.getByText("엄마").first().waitFor();
  assert.equal(await page.getByLabel("사는 지역").inputValue(), "seoul-gangnam");

  // ---- 나가기 ----
  await page.getByRole("button", { name: "나가기" }).click();
  await page.waitForURL(`${BASE}/`); // 나가기는 기존대로 첫 화면으로 보낸다
  assert.equal((await post({ kind: "member.color", id: "haneul", color: "blue" })).status(), 401);
  await page.goto(`${BASE}/settings`);
  await page.getByLabel("관리자 PIN").waitFor();
  ok("나가기 후 세션 끝: API 401");
} finally {
  await browser.close();
  server.kill();
}
console.log("모두 통과");
