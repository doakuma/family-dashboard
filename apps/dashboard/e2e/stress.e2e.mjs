// 스트레스 화면 E2E (pnpm check에는 포함되지 않음). 사전: `pnpm --filter @hsh/dashboard build`, Playwright 설치.
//   node apps/dashboard/e2e/stress.e2e.mjs [--shots]   (--shots: docs/screens에 캡처 저장)
// fixtures/stress-wiki(80자 제목, 하루 14건)를 임시 git 레포로 복사해 운영 모드 서버를 띄우고 확인한다.
import { cpSync, mkdtempSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
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
const repo = resolve(root, "../..");
const shots = process.argv.includes("--shots");
const PORT = 3218;
const LOCAL = `http://127.0.0.1:${PORT}`;

const wiki = mkdtempSync(join(tmpdir(), "hsh-stress-wiki-"));
cpSync(join(repo, "fixtures/stress-wiki"), wiki, { recursive: true });
const g = (...a) => execFileSync("git", ["-C", wiki, ...a], { stdio: "ignore" });
g("init", "-q");
g("add", ".");
g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "stress");

const server = spawn("node", ["server.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), WIKI_REPO_PATH: wiki, DASHBOARD_BASE_URL: LOCAL, NODE_ENV: undefined },
  stdio: "ignore",
});
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
let step = 0;
const ok = (msg) => console.log(`ok ${++step} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DAY = "?at=2026-11-03T12:00:00%2B09:00"; // 지난 일정 3건(07:30·09:00·11:00), 남은 일정 6건
const NIGHT = "?at=2026-11-03T08:00:00%2B09:00&mode=night";
const sizes = [
  [1280, 800],
  [1024, 600],
];

/** 화면 전체가 스크롤되지 않는다: 문서 크기 == 뷰포트, 스크롤 위치 0 */
async function assertNoPageScroll(page, w, h, label) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    bw: document.body.scrollWidth,
    iw: window.innerWidth,
    ih: window.innerHeight,
    x: window.scrollX,
    y: window.scrollY,
  }));
  assert.equal(m.iw, w);
  assert.equal(m.sw, w, `${label}: 가로 넘침 scrollWidth=${m.sw}`);
  assert.equal(m.bw, w, `${label}: body 가로 넘침`);
  assert.ok(m.sh <= h, `${label}: 세로 넘침 scrollHeight=${m.sh} > ${h}`);
  assert.deepEqual([m.x, m.y], [0, 0], label);
}

/** 손가락으로 (x,y)에서 위로 dy만큼 민다(dy>0이면 내용이 아래로 스크롤됨) */
async function swipeUp(page, cdp, x, y, dy) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - (dy * i) / 10 }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const browser = await pw.chromium.launch();
try {
  await waitFor(`${LOCAL}/api/state`);

  for (const [w, h] of sizes) {
    // 1. 야간: 80자 제목이 가로로 넘치지 않는다
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${LOCAL}/${NIGHT}`);
    await page.getByText("종일").first().waitFor();
    await assertNoPageScroll(page, w, h, `야간 ${w}x${h}`);
    const title = page.locator("section ol li").first().locator("span").nth(1);
    assert.ok(await title.evaluate((el) => el.scrollWidth > el.clientWidth), "80자 제목이 말줄임으로 잘려야 해요(픽스처 확인)");
    if (shots) await page.screenshot({ path: join(repo, `docs/screens/stress-night-${w}.png`) });
    ok(`야간 ${w}x${h}: scrollWidth == 뷰포트, 80자 제목은 말줄임`);

    // 2. 낮: 오늘 일정이 넘치고, 자동 순환하며, 화면 전체는 스크롤 0
    await page.goto(`${LOCAL}/${DAY}`);
    const box = page.locator("[data-auto-scroll]");
    await box.waitFor();
    await assertNoPageScroll(page, w, h, `낮 ${w}x${h}`);
    const m0 = await box.evaluate((el) => ({ over: el.scrollHeight - el.clientHeight, top: el.scrollTop, n: el.querySelectorAll("li").length, bar: getComputedStyle(el).scrollbarWidth }));
    assert.equal(m0.n, 14, "14건 전부(‘외 n건’ 없음)");
    assert.ok(m0.over > 10, `넘침 픽스처인데 안 넘쳐요(${m0.over})`);
    assert.equal(m0.bar, "none");
    assert.equal(await page.locator("section[aria-labelledby=agenda-title]").getByText(/외 \d+건/).count(), 0);
    // 남은 일정이 먼저, 지난 일정은 아래
    const pastFlags = await box.locator("li").evaluateAll((els) => els.map((el) => el.hasAttribute("data-past")));
    const firstPast = pastFlags.indexOf(true);
    assert.ok(firstPast > 0 && pastFlags.slice(firstPast).every(Boolean) && pastFlags.slice(0, firstPast).every((f) => !f), `순서 ${pastFlags}`);
    const tomorrow = page.locator("p", { hasText: "내일" });
    const tBefore = await tomorrow.boundingBox();
    assert.ok(tBefore && tBefore.y + tBefore.height <= h, "내일 줄은 화면 안에 고정");

    await sleep(7000); // 위에서 3.5초 멈춤 뒤 내려가기 시작
    const t1 = await box.evaluate((el) => el.scrollTop);
    assert.ok(t1 > 5, `자동 순환이 안 움직여요(scrollTop=${t1})`);
    const tAfter = await tomorrow.boundingBox();
    assert.equal(tAfter.y, tBefore.y, "스크롤해도 내일 줄은 제자리");
    await assertNoPageScroll(page, w, h, `낮(순환 중) ${w}x${h}`);
    ok(`낮 ${w}x${h}: 넘침 ${m0.over}px, 14건, 남은 일정 먼저, 자동 순환(scrollTop ${t1.toFixed(0)}), 화면 전체 스크롤 0, 내일 줄 고정`);
    if (shots) await page.screenshot({ path: join(repo, `docs/screens/stress-agenda-${w}.png`) });
    await ctx.close();
  }

  // 3. 터치: 손으로 스크롤하면 자동 순환이 멈춘다(120초 뒤 재개는 순수 함수 테스트로 확인)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${LOCAL}/${DAY}`);
    const box = page.locator("[data-auto-scroll]");
    await box.waitFor();
    const r = await box.boundingBox();
    const cdp = await ctx.newCDPSession(page);
    await swipeUp(page, cdp, r.x + r.width / 2, r.y + r.height / 2, 60);
    await sleep(500);
    const t1 = await box.evaluate((el) => el.scrollTop);
    assert.ok(t1 >= 30, `손 스크롤이 안 돼요(scrollTop=${t1})`);
    await sleep(5000);
    const t2 = await box.evaluate((el) => el.scrollTop);
    assert.ok(Math.abs(t2 - t1) < 1, `손을 댄 뒤에도 자동 순환이 계속돼요(${t1} -> ${t2})`);
    // 화면의 다른 곳을 밀어도 문서는 스크롤되지 않는다
    await swipeUp(page, cdp, 640, 700, 300);
    await sleep(300);
    await assertNoPageScroll(page, 1280, 800, "터치 후");
    ok("터치 스크롤 가능, 만진 뒤 자동 순환 멈춤, 다른 영역 터치로 화면은 스크롤 안 됨");
    await ctx.close();
  }

  // 4. prefers-reduced-motion: 자동 순환 없음
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`${LOCAL}/${DAY}`);
    const box = page.locator("[data-auto-scroll]");
    await box.waitFor();
    await sleep(7000);
    assert.equal(await box.evaluate((el) => el.scrollTop), 0);
    ok("reduced-motion: 자동 순환 없음");
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log("모두 통과");
