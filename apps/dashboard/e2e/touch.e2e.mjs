// 달력 보기 터치 E2E (pnpm check에는 포함되지 않음). 사전: `pnpm --filter @hsh/dashboard build`, Playwright 설치.
//   node apps/dashboard/e2e/touch.e2e.mjs [--shots]   (--shots: docs/screens/touch-*.png 저장)
// fixtures/sample-wiki를 임시 git 레포로 복사해 서버를 띄우고, 터치 에뮬레이션(hasTouch, 1280×800)으로
// 날짜 탭 -> 시트, 일정 상세, 스와이프 달 이동, 120초 자동 복귀(가짜 시계), 폴링 뒤 상태 유지, 핀치·길게 누르기 차단, 야간 터치를 확인한다.
import { appendFileSync, cpSync, mkdtempSync } from "node:fs";
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
const PORT = 3221;
const LOCAL = `http://127.0.0.1:${PORT}`;

const wiki = mkdtempSync(join(tmpdir(), "hsh-touch-wiki-"));
cpSync(join(repo, "fixtures/sample-wiki"), wiki, { recursive: true });
const git = (...a) => execFileSync("git", ["-C", wiki, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
// 11/3을 4건으로 만들어 달력 칸에는 "외 2건"이 나오게 한다
appendFileSync(join(wiki, "events/2026-11.md"), "- [ ] 2026-11-03 19:00 저녁 모임 @dad #evt-t001\n- [ ] 2026-11-03 20:00-21:00 책 읽기 @bada @mom #evt-t002\n");
git("init", "-q");
git("add", ".");
git("commit", "-qm", "sample");

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 0;
const ok = (msg) => console.log(`ok ${++step} ${msg}`);

const DAY = "at=2026-11-03T12:00:00%2B09:00";
const NIGHT = "at=2026-11-03T02:00:00%2B09:00";
const W = 1280;
const H = 800;

const seoul = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const cell = (page, date) => page.locator(`button[data-date="${date}"]`);
const dialog = (page) => page.getByRole("dialog");
const calTitle = (page) => page.locator('section[aria-label$="달력"] h2').innerText().then((t) => t.replace(/\s+/g, " ").trim());
const html = (page) => page.evaluate(() => ({ skin: document.documentElement.dataset.skin, mode: document.documentElement.dataset.mode, tone: document.documentElement.dataset.tone }));
const noScroll = (page, label) =>
  page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, window.innerWidth, window.innerHeight]).then(([sw, sh, iw, ih]) => {
    assert.equal(sw, iw, `${label}: 가로 넘침`);
    assert.ok(sh <= ih, `${label}: 세로 넘침 ${sh} > ${ih}`);
  });

/** 손가락 하나로 (x,y)에서 (x+dx,y+dy)까지 민다 */
async function swipe(cdp, x, y, dx, dy = 0) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }] });
    await sleep(12);
  }
  await sleep(150); // 멈췄다가 뗀다: 속도가 남은 채 떼면 Chromium이 관성 스크롤로 보고 바로 다음 탭을 삼킨다(에뮬레이션 한정)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function open(browser, query, { clock = false, touch = true, skin } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (clock) await page.clock.install();
  await page.goto(`${LOCAL}/?${query}${skin ? `&skin=${skin}` : ""}`);
  await page.locator("main").waitFor();
  return { ctx, page, errors, cdp: await ctx.newCDPSession(page) };
}

const browser = await pw.chromium.launch();
try {
  await waitFor(`${LOCAL}/api/state`);

  // 1. /api/state?month: 엄격한 검증, 없는 달은 빈 달, share는 그룹 id만
  {
    for (const bad of ["2026-13", "2026-00", "2026-1", "202611", "abc", "", "2026-11-01", "1999-12", "2101-01", "2026-11&month=2026-12", "%202026-11"]) {
      const r = await fetch(`${LOCAL}/api/state?month=${bad}`);
      assert.equal(r.status, 400, `month=${bad}`);
      assert.equal((await r.json()).error, "invalid_month");
    }
    const r = await fetch(`${LOCAL}/api/state?month=2030-01`);
    assert.equal(r.status, 200);
    const empty = await r.json();
    const today = seoul(new Date());
    const tomorrow = seoul(new Date(Date.now() + 86_400_000));
    assert.ok(empty.events.every((e) => e.date === today || e.date === tomorrow), "일정 파일이 없는 달은 오늘·내일 일정 외에는 비어야 해요");
    const nov = await (await fetch(`${LOCAL}/api/state?month=2026-11`)).json();
    assert.ok(nov.events.filter((e) => e.date === "2026-11-03").length === 4);
    const shared = nov.events.filter((e) => e.share);
    assert.deepEqual(shared.map((e) => e.share), ["cousins"]);
    assert.ok(!JSON.stringify(nov).includes("&"), "원문 토큰(&)이 응답에 새면 안 돼요");
    const dec = await (await fetch(`${LOCAL}/api/state?month=2026-12`)).json();
    assert.ok(dec.events.every((e) => e.date >= "2026-11-29" || e.date === today || e.date === tomorrow), "12월 달력 칸(11/29~) 밖의 일정이 섞였어요");
    ok("/api/state?month: 잘못된 값 11종 400, 없는 달은 빈 달(+오늘·내일), share는 그룹 id만, 12월 응답은 12월 달력 칸 범위");
  }

  // 2. 날짜 탭 -> 시트(외 n건 포함 전부), 일정 탭 -> 상세, 접근성
  {
    const { ctx, page, errors } = await open(browser, DAY);
    await cell(page, "2026-11-03").waitFor();
    assert.match(await cell(page, "2026-11-03").innerText(), /외 2건/);
    assert.equal(await dialog(page).count(), 0);
    await cell(page, "2026-11-03").tap();
    await dialog(page).waitFor();
    const items = dialog(page).getByRole("listitem");
    assert.equal(await items.count(), 4, "칸에는 2건 + 외 2건 -> 시트에는 4건 전부");
    const texts = await items.allInnerTexts();
    assert.ok(texts[0].includes("15:00") && texts[0].includes("치과 검진"), texts.join("|"));
    assert.ok(texts.some((t) => t.includes("저녁 모임")) && texts.some((t) => t.includes("책 읽기")));
    assert.equal(await dialog(page).getAttribute("aria-modal"), "true");
    const labelled = await dialog(page).getAttribute("aria-labelledby");
    assert.match(await page.locator(`#${labelled}`).innerText(), /11월 3일\s*화요일/);
    assert.ok(await page.evaluate(() => document.querySelector("main").inert), "뒤 화면은 inert");
    assert.ok(await dialog(page).evaluate((el) => el.contains(document.activeElement)), "포커스가 시트 안으로 이동");
    await noScroll(page, "시트 열림");
    if (shots) await page.screenshot({ path: join(repo, "docs/screens/touch-sheet-list.png") });

    // 터치 영역 48px
    for (const [name, loc] of [["닫기", dialog(page).getByRole("button", { name: "닫기" })], ["일정 항목", items.first().getByRole("button")]]) {
      const bb = await loc.boundingBox();
      assert.ok(bb && bb.width >= 48 && bb.height >= 48, `${name} 48px 미만 ${bb?.width}x${bb?.height}`);
    }

    // 일정 탭 -> 상세
    await items.first().getByRole("button").tap();
    await dialog(page).getByText("고치려면 슬랙에서 말해주세요").waitFor();
    const detail = await dialog(page).innerText();
    assert.ok(detail.includes("치과 검진") && detail.includes("15:00-16:00") && detail.includes("하늘"), detail);
    assert.ok(!detail.includes("공유 그룹"), "share 없는 일정에는 공유 그룹 줄이 없어요");
    assert.ok(await dialog(page).evaluate((el) => el.contains(document.activeElement)));
    const back = dialog(page).getByRole("button", { name: /목록으로/ });
    assert.ok((await back.boundingBox()).height >= 48);
    if (shots) await page.screenshot({ path: join(repo, "docs/screens/touch-sheet-detail.png") });
    await back.tap();
    await items.first().waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-event-id")), "evt-2b02", "목록으로 돌아오면 방금 보던 일정에 포커스");

    // Tab은 시트 안에서만 돈다
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      assert.ok(await dialog(page).evaluate((el) => el.contains(document.activeElement)), `Tab ${i}: 포커스가 시트를 벗어남`);
    }
    // Esc로 닫고 포커스는 눌렀던 날짜 칸으로
    await page.keyboard.press("Escape");
    await dialog(page).waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-date")), "2026-11-03");
    ok("날짜 탭 -> 시트에 4건 전부, 일정 탭 -> 시간·구성원·안내, role=dialog·aria-modal·inert·포커스 이동/복귀·Tab 가둠·Esc, 48px");

    // 공유 그룹 일정 상세
    await cell(page, "2026-11-15").tap();
    await dialog(page).getByRole("button", { name: /사촌 모임 점심/ }).tap();
    const shareText = await dialog(page).innerText();
    assert.ok(/공유 그룹\s*cousins/.test(shareText), shareText);
    await dialog(page).getByRole("button", { name: "닫기" }).tap();
    await dialog(page).waitFor({ state: "detached" });
    // 어두운 바깥 탭으로 닫기
    await cell(page, "2026-11-03").tap();
    await dialog(page).waitFor();
    await page.getByTestId("sheet-scrim").tap({ position: { x: 100, y: 400 } });
    await dialog(page).waitFor({ state: "detached" });
    // 일정 없는 날
    await cell(page, "2026-11-02").tap();
    await dialog(page).getByText("이 날은 일정이 없어요").waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, [], `콘솔 오류: ${errors.join("|")}`);
    ok("공유 그룹 표시(cousins), 닫기·바깥 탭·빈 날, 콘솔 오류 없음");

    // 터치 반응이 없는 위젯
    for (const sel of ['section[aria-label="장보기와 할 일"]', 'section[aria-labelledby="dday-title"]']) {
      assert.equal(await page.locator(`${sel} button, ${sel} [role=button], ${sel} [tabindex]`).count(), 0, sel);
      const bb = await page.locator(sel).boundingBox();
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
      assert.equal(await dialog(page).count(), 0, `${sel}를 눌렀는데 반응했어요`);
    }
    const weather = page.locator("main > div").nth(1);
    const wb = await weather.boundingBox();
    await page.touchscreen.tap(wb.x + wb.width / 2, wb.y + wb.height / 2);
    assert.equal(await weather.locator("button").count(), 0);
    assert.equal(await dialog(page).count(), 0);
    assert.equal(await page.locator('section[aria-labelledby="agenda-title"] button').count() <= 1, true, "오늘 일정에는 자동 넘김 버튼 하나만");
    ok("체크리스트·날씨·다가오는 날은 버튼·포커스 요소가 없고 눌러도 반응 없음");
    await ctx.close();
  }

  // 3. 달 이동: ‹ › 버튼, 스와이프, 범위 제한 없음, 칸 탭과 구분
  {
    const { ctx, page, cdp } = await open(browser, DAY);
    await cell(page, "2026-11-03").waitFor();
    assert.equal(await calTitle(page), "11월 2026");
    for (const name of ["이전 달", "다음 달"]) {
      const bb = await page.getByRole("button", { name }).boundingBox();
      assert.ok(bb.width >= 48 && bb.height >= 48, `${name} 48px 미만 ${bb.width}x${bb.height}`);
    }
    const req = page.waitForRequest((r) => r.url().includes("/api/state?month=2026-12"));
    await page.getByRole("button", { name: "다음 달" }).tap();
    await req;
    assert.equal(await calTitle(page), "12월 2026");
    await page.getByRole("button", { name: "이전 달" }).tap();
    assert.equal(await calTitle(page), "11월 2026");

    // 스와이프: 왼쪽으로 밀면 다음 달, 오른쪽이면 이전 달. 날짜 칸이 같이 눌리지 않는다.
    const g = await page.locator("section[aria-label$='달력'] ol").boundingBox();
    const y = g.y + g.height / 2;
    await swipe(cdp, g.x + g.width * 0.75, y, -g.width * 0.5);
    await page.waitForFunction(() => document.querySelector("section[aria-label$='달력'] h2")?.textContent?.includes("12월"));
    assert.equal(await dialog(page).count(), 0, "스와이프가 날짜 칸 탭으로 번졌어요");
    for (let i = 0; i < 2; i++) await swipe(cdp, g.x + g.width * 0.75, y, -g.width * 0.5);
    await page.waitForFunction(() => document.querySelector("section[aria-label$='달력'] h2")?.textContent?.includes("2027"));
    assert.equal(await calTitle(page), "2월 2027", "스와이프 3번 = 2027-02");
    if (shots) await page.screenshot({ path: join(repo, "docs/screens/touch-month-swipe.png") });
    // 일정 파일이 없는 달: 빈 달, 칸을 누르면 빈 시트
    assert.equal(await page.locator("section[aria-label$='달력'] ol li").evaluateAll((els) => els.filter((e) => e.querySelector("span[class*='event']")).length), 0);
    await sleep(450); // 스와이프 직후 400ms 동안은 그 손짓이 만든 클릭을 삼킨다(실제 손짓에선 클릭이 안 생기지만 안전장치)
    await cell(page, "2027-02-10").tap();
    await dialog(page).getByText("이 날은 일정이 없어요").waitFor();
    // 시트가 열린 채 달을 옮기면 시트는 닫힌다(시트가 inert 뒤라 버튼은 못 누르므로 먼저 닫는다)
    await page.keyboard.press("Escape");
    await swipe(cdp, g.x + g.width * 0.25, y, g.width * 0.5);
    await page.waitForFunction(() => document.querySelector("section[aria-label$='달력'] h2")?.textContent?.includes("1월"));
    // 세로로 민 것은 달 이동이 아니다
    await swipe(cdp, g.x + g.width / 2, y, 20, 150);
    assert.equal(await calTitle(page), "1월 2027");
    await noScroll(page, "스와이프 뒤");
    ok("‹ › 버튼(48px)·좌우 스와이프로 달 이동, 일정 파일 없는 2027-02는 빈 달, 세로 스와이프·스와이프 중 칸 탭 없음");
    await ctx.close();
  }

  // 4. 120초 자동 복귀(가짜 시계) + 폴링 뒤 상태 유지
  {
    const { ctx, page } = await open(browser, DAY, { clock: true });
    await cell(page, "2026-11-03").waitFor();
    await page.evaluate(() => {
      window.__marker = "same-document";
    });
    // 4-1. 다른 달로 간 뒤 손을 떼면 120초 안에 오늘 화면
    await page.getByRole("button", { name: "다음 달" }).tap();
    await page.getByRole("button", { name: "다음 달" }).tap();
    assert.equal(await calTitle(page), "1월 2027");
    await page.clock.fastForward(119_000);
    assert.equal(await calTitle(page), "1월 2027", "119초에는 아직 그대로");
    await page.clock.fastForward(2_000);
    await page.waitForFunction(() => document.querySelector("section[aria-label$='달력'] h2")?.textContent?.includes("11월"), undefined, { timeout: 5000 });
    assert.equal(await calTitle(page), "11월 2026");
    assert.equal(await page.evaluate(() => window.__marker), "same-document", "새로고침 없이 돌아와야 해요");
    ok("두 달 넘긴 뒤 119초는 그대로, 121초에 이번 달로 자동 복귀(새로고침 없음)");

    // 4-2. 터치할 때마다 120초가 다시 시작된다
    await page.getByRole("button", { name: "다음 달" }).tap();
    await page.clock.fastForward(100_000);
    await page.getByRole("button", { name: "다음 달" }).tap(); // 100초째 터치 -> 타이머 새로
    await page.clock.fastForward(100_000);
    assert.equal(await calTitle(page), "1월 2027", "마지막 터치 후 100초라 유지");
    await page.clock.fastForward(21_000);
    await page.waitForFunction(() => document.querySelector("section[aria-label$='달력'] h2")?.textContent?.includes("11월"), undefined, { timeout: 5000 });
    ok("마지막 터치 기준으로 120초(중간 터치가 타이머를 다시 시작)");

    // 4-3. 폴링이 와도 시트·달을 유지하고, 데이터만 갱신된다. 120초가 지나면 시트도 닫고 복귀.
    await page.getByRole("button", { name: "다음 달" }).tap();
    await page.getByRole("button", { name: "이전 달" }).tap();
    await cell(page, "2026-11-03").tap();
    await dialog(page).waitFor();
    assert.equal(await dialog(page).getByRole("listitem").count(), 4);
    appendFileSync(join(wiki, "events/2026-11.md"), "- [ ] 2026-11-03 21:30 야식 @mom #evt-t003\n");
    git("commit", "-qam", "late event");
    const polled = page.waitForResponse((r) => r.url().includes("/api/state?month=2026-11") && r.ok());
    await page.clock.fastForward(61_000); // 폴링 간격 60초
    await polled;
    await dialog(page).getByText("야식").waitFor();
    assert.equal(await dialog(page).getByRole("listitem").count(), 5, "폴링으로 새 일정이 시트에 들어옴");
    assert.equal(await calTitle(page), "11월 2026");
    assert.equal(await page.evaluate(() => window.__marker), "same-document");
    ok("폴링(60초) 뒤에도 열린 시트·보던 상태 유지, 새 데이터만 반영");
    await page.clock.fastForward(61_000); // 마지막 터치 후 122초
    await dialog(page).waitFor({ state: "detached", timeout: 5000 });
    ok("마지막 터치 후 120초 -> 시트 닫힘");
    await ctx.close();
  }

  // 5. 키오스크 오작동 방지: 핀치 줌·당겨서 새로고침·길게 누르기·글자 선택
  {
    const { ctx, page, cdp } = await open(browser, DAY);
    await cell(page, "2026-11-03").waitFor();
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    assert.match(viewport, /maximum-scale=1/);
    assert.match(viewport, /user-scalable=no/);
    const css = await page.evaluate(() => {
      const b = getComputedStyle(document.body);
      const h = getComputedStyle(document.documentElement);
      return { ta: b.touchAction, taHtml: h.touchAction, ob: b.overscrollBehaviorY, obx: b.overscrollBehaviorX, us: b.userSelect, tc: b.getPropertyValue("-webkit-touch-callout") };
    });
    assert.equal(css.ta, "pan-y");
    assert.equal(css.taHtml, "pan-y");
    assert.equal(css.ob, "none");
    assert.equal(css.obx, "none");
    assert.equal(css.us, "none");
    // 오늘 일정 영역은 pan-y를 유지하고 자동 넘김 버튼이 살아 있다
    assert.equal(await page.locator("[data-auto-scroll]").evaluate((el) => getComputedStyle(el).touchAction), "pan-y");

    // 길게 누르기 메뉴·글자 선택은 막혀 있다
    const prevented = await page.evaluate(() => {
      const el = document.querySelector("h1, h2");
      const fire = (type) => {
        const e = document.createEvent("Event");
        e.initEvent(type, true, true);
        el.dispatchEvent(e);
        return e.defaultPrevented;
      };
      return { contextmenu: fire("contextmenu"), selectstart: fire("selectstart"), dragstart: fire("dragstart") };
    });
    assert.deepEqual(prevented, { contextmenu: true, selectstart: true, dragstart: true });
    const title = await page.locator("section[aria-label$='달력'] h2").boundingBox();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: title.x + 20, y: title.y + title.height / 2 }] });
    await sleep(1200); // 길게 누르기
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ""), "", "길게 눌러도 글자가 선택되면 안 돼요");

    // 두 손가락 핀치: 화면 배율이 그대로
    const scale0 = await page.evaluate(() => window.visualViewport.scale);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 500, y: 400, id: 1 }, { x: 700, y: 400, id: 2 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 500 - i * 25, y: 400, id: 1 }, { x: 700 + i * 25, y: 400, id: 2 }] });
      await sleep(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(300);
    assert.equal(await page.evaluate(() => window.visualViewport.scale), scale0, "두 손가락 터치로 화면이 확대되었어요");

    // 아래로 끌어당기기(당겨서 새로고침): 문서가 같은 문서이고 스크롤 0
    await page.evaluate(() => {
      window.__marker = "same-document";
    });
    await swipe(cdp, 640, 5, 0, 500);
    await sleep(500);
    assert.equal(await page.evaluate(() => window.__marker), "same-document", "당겨서 새로고침으로 문서가 다시 불렸어요");
    await noScroll(page, "당긴 뒤");
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    ok("viewport(max-scale=1)·touch-action pan-y·overscroll none·user-select none, 길게 누르기/선택/끌기 차단, 핀치 배율 불변, 당겨도 새로고침 없음");
    await ctx.close();

    // 실제 핀치 제스처: 모바일 에뮬레이션(isMobile)에서만 viewport 메타를 따른다. 대조군(보호 없는 페이지)은 같은 핀치로 확대된다 -> 검사가 유효.
    const mctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
    const mpage = await mctx.newPage();
    await mpage.goto(`${LOCAL}/?${DAY}`);
    await mpage.locator("main").waitFor();
    const mcdp = await mctx.newCDPSession(mpage);
    await mcdp.send("Input.synthesizePinchGesture", { x: 640, y: 400, scaleFactor: 2.5 });
    await sleep(500);
    assert.equal(await mpage.evaluate(() => window.visualViewport.scale), 1, "핀치로 키오스크 화면이 확대되었어요");
    await noScroll(mpage, "핀치 뒤");
    const control = await mctx.newPage();
    await control.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><body style="height:3000px">대조군</body>');
    await (await mctx.newCDPSession(control)).send("Input.synthesizePinchGesture", { x: 640, y: 400, scaleFactor: 2.5 });
    await sleep(500);
    const zoomed = await control.evaluate(() => window.visualViewport.scale);
    assert.ok(zoomed > 1.5, `대조군이 확대되지 않아 핀치 검사가 무의미해요(${zoomed})`);
    await mctx.close();
    ok(`실제 핀치 제스처(모바일 에뮬레이션): 키오스크는 배율 1 유지, 보호 없는 대조군은 ${zoomed.toFixed(1)}배로 확대`);
  }

  // 6. 야간: 터치하면 어두운 톤 그대로 낮 화면 구성, 120초 뒤 야간 화면 복귀. 첫 HTML에 낮밤 톤이 이미 있다.
  {
    const raw = await (await fetch(`${LOCAL}/`)).text();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const nightNow = hour >= 23 || hour < 6;
    assert.match(raw, new RegExp(`<html[^>]*data-mode="${nightNow ? "night" : "day"}"[^>]*data-tone="${nightNow ? "dim" : "normal"}"`), "첫 HTML에 서버 시각 기준 data-mode·data-tone이 있어야 해요");
    ok(`첫 HTML에 <html data-mode="${nightNow ? "night" : "day"}" data-tone="${nightNow ? "dim" : "normal"}"> (서버 시각 기준, 깜빡임 방지)`);
    const setup = await fetch(`${LOCAL}/setup`, { redirect: "manual" });
    assert.ok(!/data-tone="dim"/.test(await setup.text()), "/setup(휴대폰)은 항상 보통 톤");

    for (const skin of ["default", "paper"]) {
      const { ctx, page } = await open(browser, NIGHT, { clock: true, skin });
      await page.waitForFunction(() => document.documentElement.dataset.mode === "night");
      assert.deepEqual(await html(page), { skin, mode: "night", tone: "dim" });
      assert.equal(await page.locator("section[aria-label$='달력']").count(), 0, "야간 화면에는 달력이 없어요");
      const nightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      if (shots && skin === "default") await page.screenshot({ path: join(repo, "docs/screens/touch-night.png") });

      await page.touchscreen.tap(640, 400);
      await page.locator("section[aria-label$='달력']").waitFor();
      assert.deepEqual(await html(page), { skin, mode: "day", tone: "dim" }, "야간에 만지면 낮 화면 구성 + 어두운 톤");
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), nightBg, "어두운 톤 배경 유지");
      assert.equal(await dialog(page).count(), 0, "깨우는 탭이 날짜 칸을 눌러 시트를 열면 안 돼요");
      await sleep(700); // 깨운 직후 600ms는 클릭을 삼킨다
      await cell(page, "2026-11-03").tap();
      await dialog(page).waitFor();
      const sheetBg = await dialog(page).evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.notEqual(sheetBg, "rgba(0, 0, 0, 0)");
      assert.ok(Number(sheetBg.match(/\d+/g).slice(0, 3).reduce((a, b) => a + Number(b), 0)) < 300, `어두운 톤의 시트 배경이 밝아요: ${sheetBg}`);
      await noScroll(page, `${skin} 야간 터치 시트`);
      if (shots) await page.screenshot({ path: join(repo, `docs/screens/touch-night-wake-${skin}.png`) });

      await page.clock.fastForward(121_000);
      await page.waitForFunction(() => document.documentElement.dataset.mode === "night", undefined, { timeout: 5000 });
      assert.deepEqual(await html(page), { skin, mode: "night", tone: "dim" });
      assert.equal(await dialog(page).count(), 0);
      assert.equal(await page.locator("section[aria-label$='달력']").count(), 0);
      await ctx.close();
    }
    ok("야간(02시): 터치 -> data-mode=day·data-tone=dim(두 스킨 모두) -> 시트도 어두운 톤 -> 121초 뒤 야간 화면·시트 닫힘");
  }

  // 7. 낮: 두 스킨에서 시트가 토큰을 따라 바뀐다(배치는 같다)
  {
    const bgs = {};
    const sizes = {};
    for (const skin of ["default", "paper"]) {
      const { ctx, page } = await open(browser, DAY, { skin });
      await cell(page, "2026-11-03").tap();
      await dialog(page).waitFor();
      bgs[skin] = await dialog(page).evaluate((el) => getComputedStyle(el).backgroundColor);
      sizes[skin] = await dialog(page).boundingBox();
      await noScroll(page, `${skin} 시트`);
      if (shots) await page.screenshot({ path: join(repo, `docs/screens/touch-sheet-${skin}.png`) });
      await ctx.close();
    }
    assert.notEqual(bgs.default, bgs.paper);
    for (const k of ["x", "y", "width", "height"]) assert.ok(Math.abs(sizes.default[k] - sizes.paper[k]) <= 1, `시트 ${k}가 스킨마다 달라요`);
    ok("시트: 두 스킨의 배경은 다르고(토큰) 위치·크기는 같음");
  }
} finally {
  await browser.close();
  server.kill();
}
console.log("모두 통과");
