// 스킨 전환 E2E (pnpm check에는 포함되지 않음). 사전: `pnpm --filter @hsh/dashboard build`, Playwright 설치.
//   node apps/dashboard/e2e/skin.e2e.mjs [--shots]   (--shots: docs/screens/skin-*.png 저장)
// fixtures/sample-wiki를 임시 git 레포로 복사해 서버를 띄우고, 두 스킨 × 낮/야간(1280×800)과 폴링 전환을 확인한다.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const PORT = 3219;
const LOCAL = `http://127.0.0.1:${PORT}`;

const wiki = mkdtempSync(join(tmpdir(), "hsh-skin-wiki-"));
cpSync(join(repo, "fixtures/sample-wiki"), wiki, { recursive: true });
const git = (...a) => execFileSync("git", ["-C", wiki, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
git("init", "-q");
git("add", ".");
git("commit", "-qm", "sample");

// 운영 빌드(server.ts는 --dev 없으면 production)에서도 ?at·?mode·?skin을 쓰도록 테스트 전용 플래그 HSH_PREVIEW_QUERY=1을 켠다. 운영 기본값은 꺼짐.
const server = spawn("node", ["server.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), WIKI_REPO_PATH: wiki, DASHBOARD_BASE_URL: LOCAL, NODE_ENV: undefined, HSH_PREVIEW_QUERY: "1" },
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

const DAY = "at=2026-11-03T12:00:00%2B09:00";
const NIGHT = "at=2026-11-03T08:00:00%2B09:00&mode=night";
const W = 1280;
const H = 800;

const html = (page) => page.evaluate(() => ({ skin: document.documentElement.dataset.skin, tone: document.documentElement.dataset.tone }));
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const noScroll = (page, label) =>
  page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, window.innerWidth, window.innerHeight]).then(([sw, sh, iw, ih]) => {
    assert.equal(sw, iw, `${label}: 가로 넘침`);
    assert.ok(sh <= ih, `${label}: 세로 넘침 ${sh} > ${ih}`);
  });

const browser = await pw.chromium.launch();
try {
  await waitFor(`${LOCAL}/api/state`);
  const state = await (await fetch(`${LOCAL}/api/state`)).json();
  assert.equal(state.skin, "default");
  assert.equal(state.character, "none");
  assert.ok(!("config" in state));
  ok("/api/state: skin=default, character=none (config 원문은 없음)");

  // 1. 두 스킨 × 낮/야간 캡처 + 토큰이 실제로 적용되는지
  const bg = {};
  const boxes = {};
  for (const skin of ["default", "paper"]) {
    for (const [name, q, tone] of [["day", DAY, "normal"], ["night", NIGHT, "dim"]]) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const page = await ctx.newPage();
      await page.goto(`${LOCAL}/?${q}&skin=${skin}`);
      await page.locator("main").waitFor();
      await page.waitForFunction((s) => document.documentElement.dataset.skin === s, skin);
      assert.deepEqual(await html(page), { skin, tone });
      bg[`${skin}-${name}`] = await bodyBg(page);
      await noScroll(page, `${skin} ${name}`);
      if (name === "day") {
        // 구성원 색 점이 스킨 슬롯 색으로 칠해진다(투명이 아님)
        const dot = await page.locator('[style*="--member-"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
        assert.notEqual(dot, "rgba(0, 0, 0, 0)", `${skin}: 구성원 점 색이 비었어요(토큰 누락)`);
        bg[`${skin}-dot`] = dot;
        boxes[skin] = await page.locator("main > div").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
      }
      if (shots) await page.screenshot({ path: join(repo, `docs/screens/skin-${skin}-${name}.png`) });
      await ctx.close();
    }
  }
  assert.notEqual(bg["default-day"], bg["paper-day"], "스킨이 바뀌어도 바탕이 같아요");
  assert.notEqual(bg["default-night"], bg["paper-night"]);
  assert.notEqual(bg["default-day"], bg["default-night"]);
  assert.notEqual(bg["paper-day"], bg["paper-night"]);
  assert.notEqual(bg["default-dot"], bg["paper-dot"], "구성원 색 슬롯이 스킨마다 달라야 해요");
  ok("두 스킨 × 낮/야간 1280×800: data-skin·data-tone, 바탕·구성원 색이 모두 다름, 화면 스크롤 0");

  // 1-2. 배치 불변: 두 스킨의 위젯 영역 boundingBox가 같다(오차 1px)
  assert.equal(boxes.default.length, 6, "위젯 영역 6개");
  assert.equal(boxes.paper.length, 6);
  boxes.default.forEach((a, i) => a.forEach((v, j) => assert.ok(Math.abs(v - boxes.paper[i][j]) <= 1, `위젯 ${i} 값 ${j}: ${v} vs ${boxes.paper[i][j]} (스킨이 배치를 바꿈)`)));
  ok("두 스킨의 위젯 영역 6개 boundingBox가 같음(오차 1px)");

  // 2. 모르는 ?skin 값은 무시(위키 값 사용)
  {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    await page.goto(`${LOCAL}/?${DAY}&skin=neon`);
    await page.locator("main").waitFor();
    assert.equal((await html(page)).skin, "default");
    await ctx.close();
    ok("?skin=neon(모르는 값)은 무시하고 위키 값 사용");
  }

  // 2-2. 첫 HTML(JS 실행 전)에 서버가 data-skin을 렌더한다 -> 깜빡임 없음. 위키 값이 paper일 때는 3번 단계에서 확인한다.
  {
    const raw = await (await fetch(`${LOCAL}/`)).text();
    assert.match(raw, /<html[^>]*data-skin="default"/);
    ok("첫 HTML에 <html data-skin=\"default\">가 이미 있음");
  }

  // 3. config의 skin을 바꾸면 폴링 뒤 새로고침 없이 data-skin이 바뀐다
  {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    await page.clock.install();
    await page.goto(`${LOCAL}/?${DAY}`);
    await page.locator("main").waitFor();
    assert.equal((await html(page)).skin, "default");
    await page.evaluate(() => {
      window.__marker = "same-document"; // 새로고침이면 사라진다
    });

    const cfg = join(wiki, "config.md");
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace("skin: default", "skin: paper"));
    git("commit", "-qam", "skin paper");
    assert.equal((await (await fetch(`${LOCAL}/api/state`)).json()).skin, "paper");

    await page.clock.runFor(61_000); // 폴링 간격(60초) 경과
    await page.waitForFunction(() => document.documentElement.dataset.skin === "paper", undefined, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => window.__marker), "same-document", "새로고침 없이 바뀌어야 해요");
    assert.notEqual(await bodyBg(page), bg["default-day"]);
    await noScroll(page, "폴링 전환 뒤");
    const rawPaper = await (await fetch(`${LOCAL}/`)).text();
    assert.match(rawPaper, /<html[^>]*data-skin="paper"/, "첫 HTML이 위키의 skin을 이미 반영해야 해요");
    assert.match(rawPaper, /<meta name="theme-color" content="#f4ead6"/, "주소창 색이 스킨을 따라야 해요");
    ok("config skin: paper -> 폴링 뒤 새로고침 없이 data-skin=paper, 바탕색 바뀜");

    // 모르는 값이면 default로 돌아간다(경고만)
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace("skin: paper", "skin: neon"));
    git("commit", "-qam", "skin neon");
    assert.equal((await (await fetch(`${LOCAL}/api/state`)).json()).skin, "default");
    await page.clock.runFor(61_000);
    await page.waitForFunction(() => document.documentElement.dataset.skin === "default", undefined, { timeout: 10_000 });
    ok("config skin: neon(모르는 값) -> default로 읽고 전환");
    await ctx.close();
  }

  // 4. 운영 기본(플래그 꺼짐)에서는 ?skin·?mode·?at을 무시한다
  {
    const PORT2 = PORT + 1;
    const LOCAL2 = `http://127.0.0.1:${PORT2}`;
    const prod = spawn("node", ["server.ts"], {
      cwd: root,
      env: { ...process.env, PORT: String(PORT2), WIKI_REPO_PATH: wiki, DASHBOARD_BASE_URL: LOCAL2, NODE_ENV: undefined, HSH_PREVIEW_QUERY: undefined },
      stdio: "ignore",
    });
    try {
      await waitFor(`${LOCAL2}/api/state`);
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const page = await ctx.newPage();
      await page.goto(`${LOCAL2}/?${DAY}&mode=night&skin=default`);
      await page.locator("main").waitFor();
      const wikiSkin = (await (await fetch(`${LOCAL2}/api/state`)).json()).skin; // 위키 값(neon -> default)
      assert.equal(wikiSkin, "default");
      await page.goto(`${LOCAL2}/?mode=night&skin=paper`);
      await page.locator("main").waitFor();
      assert.equal((await html(page)).skin, wikiSkin, "운영에서 ?skin이 먹히면 안 돼요");
      await ctx.close();
      ok("운영 기본(HSH_PREVIEW_QUERY 없음)에서는 ?skin·?mode를 무시");
    } finally {
      prod.kill();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log("모두 통과");
