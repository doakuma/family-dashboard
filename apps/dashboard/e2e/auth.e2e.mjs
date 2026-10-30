// 진입 게이트 E2E (pnpm check에는 포함되지 않음). 사전: `pnpm --filter @hsh/dashboard build`, Playwright 설치.
//   node apps/dashboard/e2e/auth.e2e.mjs
// 빈 임시 위키 + 임시 PIN 해시로 운영 모드 서버(server.ts)를 직접 띄운다. .env는 읽지 않는다.
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
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
const PORT = 3217;
const BASE = `http://localhost:${PORT}`; // 태블릿은 127.0.0.1로 접속하지만 QR 주소는 이 값(다른 host)에서 만들어져야 한다. 폼 출처 확인도 이 origin과 비교한다
const LOCAL = `http://127.0.0.1:${PORT}`;
const PIN = "4821";

const wiki = mkdtempSync(join(tmpdir(), "hsh-empty-wiki-"));
execFileSync("git", ["init", "-q", wiki]);
const hashLine = execFileSync("node", ["scripts/pin-hash.ts"], { cwd: root, input: `${PIN}\n`, stdio: ["pipe", "pipe", "ignore"] }).toString().trim();
assert.match(hashLine, /^ADMIN_PIN_HASH=scrypt:/);

const env = { ...process.env, PORT: String(PORT), WIKI_REPO_PATH: wiki, DASHBOARD_BASE_URL: BASE, ADMIN_PIN_HASH: hashLine.slice("ADMIN_PIN_HASH=".length), NODE_ENV: undefined };
const servers = [];
function start(args, extraEnv = {}) {
  const p = spawn("node", args, { cwd: root, env: { ...env, ...extraEnv }, stdio: "ignore" });
  servers.push(p);
  return p;
}
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
/** Host 헤더를 마음대로 정해 보내는 요청(fetch/Playwright는 Host를 못 바꾸거나 무시할 수 있다) */
function rawRequest(port, path, headers, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
let step = 0;
const ok = (msg) => console.log(`ok ${++step} ${msg}`);

const browser = await pw.chromium.launch();
try {
  start(["server.ts"]);
  await waitFor(`${LOCAL}/api/state`);

  // 1. 세팅 필요 화면: QR 주소는 DASHBOARD_BASE_URL 기반 (접속은 127.0.0.1로 했는데도)
  const ctx = await browser.newContext();
  const tablet = await ctx.newPage();
  await tablet.goto(LOCAL);
  await tablet.getByText("가족 세팅이 필요해요").waitFor();
  assert.equal(await tablet.getByRole("img", { name: /QR코드/ }).getAttribute("aria-label"), `${BASE}/setup QR코드`);
  assert.equal(await tablet.locator("p", { hasText: `${BASE}/setup` }).count(), 1);
  const qr = await (await ctx.request.get(`${LOCAL}/api/setup-qr`)).json();
  assert.equal(qr.ok, true);
  assert.match(qr.url, new RegExp(`^${BASE.replaceAll(".", "\\.")}/setup\\?t=[A-Za-z0-9_-]{40,}$`));
  assert.ok(!qr.label.includes("?t="));
  assert.ok(qr.svg.startsWith("<svg"));
  ok("QR 주소는 DASHBOARD_BASE_URL 기반 (접속은 127.0.0.1인데 QR은 localhost)");

  // 1-b. Host 허용 목록(DNS 리바인딩 방어): 모르는 도메인은 403, 허용된 이름·IP 리터럴은 통과
  for (const [path, host] of [["/", "evil.example"], ["/api/state", "evil.example:3217"], ["/api/setup-qr", "localhost.evil.example"], ["/setup", `localhost:${PORT}.evil.example`], ["/api/state", "8.8.8.8:3217"]]) {
    assert.equal((await rawRequest(PORT, path, { Host: host })).status, 403, `${host}${path}`);
  }
  assert.equal((await rawRequest(PORT, "/api/state", { Host: "evil.example", "X-Forwarded-Host": "localhost" })).status, 403);
  for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`, `192.168.77.5:${PORT}`]) {
    assert.equal((await rawRequest(PORT, "/api/state", { Host: host })).status, 200, host);
  }
  ok("Host: evil.example -> 403, localhost·127.0.0.1·[::1]·사설 IP 리터럴은 허용");

  // 2. 토큰 없이/틀린 토큰으로 /setup 접근 거부
  for (const path of ["/setup", "/setup?t=", "/setup?t=garbage"]) {
    const r = await ctx.request.get(`${LOCAL}${path}`);
    assert.equal(r.status(), 403, path);
  }
  const direct = await ctx.request.post(`${LOCAL}/api/auth/setup`, { form: { t: "garbage", pin: PIN }, headers: { origin: BASE }, maxRedirects: 0 });
  assert.equal(direct.status(), 403);
  ok("토큰 없음·틀린 토큰은 /setup 403, 토큰 없는 PIN 제출도 403");

  // 3. 공개 응답에 민감 필드 없음 (빈 위키라 구조만)
  const stateText = await (await ctx.request.get(`${LOCAL}/api/state`)).text();
  for (const k of ["region", "slackId", "calendarId", "birth", "role", "share"]) assert.ok(!stateText.includes(`"${k}"`), k);
  ok("/api/state에 민감 키 없음");

  // 4. 휴대폰 흐름: QR 주소 열기 -> 잘못된 PIN -> 맞는 PIN -> 세션
  const phoneCtx = await browser.newContext();
  const phone = await phoneCtx.newPage();
  const phoneUrl = qr.url; // BASE 주소 그대로(= Origin이 BASE가 된다)
  await phone.goto(phoneUrl);
  await phone.getByLabel("관리자 PIN").fill("0000");
  await phone.getByRole("button", { name: "확인" }).click();
  await phone.getByRole("alert").getByText("PIN이 맞지 않아요").waitFor();
  assert.ok(phone.url().includes("/setup?t="));
  // 토큰은 PIN이 틀렸을 땐 소모되지 않는다
  await phone.getByLabel("관리자 PIN").fill(PIN);
  await phone.getByRole("button", { name: "확인" }).click();
  await phone.getByText("확인됐어요").waitFor();
  assert.equal(new URL(phone.url()).search, "");
  const cookie = (await phoneCtx.cookies()).find((c) => c.name === "hsh_session");
  assert.ok(cookie, "세션 쿠키");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Strict");
  assert.ok(cookie.expires > Date.now() / 1000 && cookie.expires < Date.now() / 1000 + 31 * 60, "만료 30분 이내");
  assert.equal(await phone.evaluate(() => document.cookie), "");
  ok("PIN 흐름: 오답 -> 정답 -> 세션 쿠키(HttpOnly, SameSite=Strict, 만료)");
  await phone.goto(`${BASE}/setup`);
  await phone.getByText("확인됐어요").waitFor();
  await phone.goto(`${BASE}/settings`);
  await phone.getByText("설정 화면은 준비 중").waitFor();
  ok("같은 세션으로 /setup, /settings 열림");

  // 5. 토큰 일회성: 쓴 토큰은 다른 브라우저에서 못 쓴다
  const other = await (await browser.newContext()).newPage();
  const r = await other.goto(phoneUrl);
  assert.equal(r.status(), 403);
  // 세션 쿠키를 위조하면 거부
  const forgedCtx = await browser.newContext();
  await forgedCtx.addCookies([{ name: "hsh_session", value: `${Buffer.from('{"via":"setup","exp":9999999999999}').toString("base64url")}.AAAA`, url: BASE }]);
  assert.equal((await (await forgedCtx.newPage()).goto(`${BASE}/setup`)).status(), 403);
  ok("쓴 토큰 재사용 403, 위조 쿠키 403");
  // 새 토큰이 재발급된다
  const qr2 = await (await ctx.request.get(`${LOCAL}/api/setup-qr`)).json();
  assert.notEqual(qr2.url, qr.url);
  ok("사용 후 새 토큰 재발급");

  // 6. /settings: PIN 없이는 폼, 세션 없으면 내용 없음. 5회 실패 잠금
  // 출처 확인: Origin이 BASE가 아니면(127.0.0.1에서 보낸 폼 포함) 맞는 PIN이어도 403. 로그인 본문 검사도 함께
  const form = { pin: PIN };
  assert.equal((await ctx.request.post(`${LOCAL}/api/auth/login`, { form, headers: { origin: LOCAL }, maxRedirects: 0 })).status(), 403);
  assert.equal((await ctx.request.post(`${LOCAL}/api/auth/login`, { form, headers: { origin: "http://evil.example" }, maxRedirects: 0 })).status(), 403);
  assert.equal((await ctx.request.post(`${LOCAL}/api/auth/login`, { form, maxRedirects: 0 })).status(), 403, "Origin·Referer 없음");
  assert.equal((await ctx.request.post(`${LOCAL}/api/auth/login`, { form, headers: { origin: BASE }, maxRedirects: 0 })).status(), 303);
  const big = await ctx.request.post(`${LOCAL}/api/auth/login`, { data: `pin=${"1".repeat(5000)}`, headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" }, maxRedirects: 0 });
  assert.equal(big.status(), 413);
  const json = await ctx.request.post(`${LOCAL}/api/auth/login`, { data: { pin: PIN }, headers: { origin: BASE }, maxRedirects: 0 });
  assert.equal(json.status(), 415);
  ok("폼 출처는 BASE origin과 비교(127.0.0.1·evil·없음 403), 큰 본문 413, 형식 다르면 415");

  const s = await (await browser.newContext()).newPage();
  await s.goto(`${BASE}/settings`);
  assert.equal(await s.getByText("설정 화면은 준비 중").count(), 0);
  for (let i = 0; i < 5; i++) {
    await s.getByLabel("관리자 PIN").fill("1111");
    await s.getByRole("button", { name: "확인" }).click();
    await s.waitForURL(/e=(wrong|locked)/);
  }
  await s.getByText("너무 많아 잠시 잠겼어요").waitFor();
  await s.getByLabel("관리자 PIN").fill(PIN); // 맞는 PIN도 잠금 중엔 거부
  await s.getByRole("button", { name: "확인" }).click();
  await s.getByText("너무 많아 잠시 잠겼어요").waitFor();
  assert.match(await s.locator("p[role=alert]").innerText(), /약 15분 뒤에 다시 해 주세요/);
  assert.equal(await s.getByText("설정 화면은 준비 중").count(), 0);
  ok("5회 실패 후 잠금(남은 15분 표시), 잠금 중엔 맞는 PIN도 거부");

  // 7. 내부망 헤더 위조: PEER·증명 헤더·XFF를 보내도 서버가 소켓 주소로 덮어쓴다(여기선 127.0.0.1이라 통과)
  const h = await fetch(`${LOCAL}/api/state`, { headers: { "x-hsh-peer": "8.8.8.8", "x-hsh-peer-proof": "forged", "x-forwarded-for": "8.8.8.8" } });
  assert.equal(h.status, 200);
  ok("위조 헤더는 판정에 영향 없음");

  // 8. custom server를 거치지 않는 `next start`는 항상 닫힌다: 비밀값이 없으므로 헤더·증명을 위조해도 403
  start(["node_modules/next/dist/bin/next", "start", "-p", "3218"], { HSH_PEER_SECRET: "" });
  await waitFor("http://127.0.0.1:3218/");
  for (const path of ["/", "/api/state", "/setup", "/settings"]) assert.equal((await fetch(`http://127.0.0.1:3218${path}`)).status, 403, path);
  const forged = { "x-hsh-peer": "127.0.0.1", "x-hsh-peer-proof": "0".repeat(64) };
  assert.equal((await fetch("http://127.0.0.1:3218/api/state", { headers: forged })).status, 403, "위조한 헤더·증명도 거부");
  const { createHmac } = await import("node:crypto");
  const guess = createHmac("sha256", "").update("peer:127.0.0.1").digest("hex"); // 빈 비밀값으로 만든 증명도 거부
  assert.equal((await fetch("http://127.0.0.1:3218/api/state", { headers: { "x-hsh-peer": "127.0.0.1", "x-hsh-peer-proof": guess } })).status, 403);
  ok("next start 단독은 헤더·증명을 위조해도 항상 403");
} finally {
  await browser.close();
  for (const p of servers) p.kill();
}
console.log("모두 통과");
