// /setup 마법사 E2E (pnpm check에는 포함되지 않음). 사전: `pnpm --filter @hsh/dashboard build`, Playwright 설치.
//   node apps/dashboard/e2e/setup.e2e.mjs            (태블릿 자동 전환 대기 때문에 약 1~2분)
//   SKIP_TABLET_WAIT=1 node ...                      (전환 대기 생략)
//   --shots                                          (docs/screens/setup-*.png 캡처 저장. 없으면 저장하지 않는다)
// 빈 임시 위키(git init) + 임시 PIN으로 운영 모드 서버를 띄워: QR 토큰 -> PIN -> 6단계 -> 시작하기 -> 위키 커밋과 /api/state를 확인한다.
// 단계별 캡처(390x844)는 docs/screens/setup-*.png.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
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
const shots = resolve(root, "../../docs/screens");
const saveShots = process.argv.includes("--shots");
if (saveShots) mkdirSync(shots, { recursive: true });
const PORT = 3219;
const BASE = `http://localhost:${PORT}`;
const LOCAL = `http://127.0.0.1:${PORT}`;
const PIN = "4821";

const wiki = mkdtempSync(join(tmpdir(), "hsh-setup-e2e-wiki-"));
const git = (...args) => execFileSync("git", args, { cwd: wiki, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
execFileSync("git", ["init", "-q", "-b", "main", wiki]);
git("config", "user.email", "e2e@example.com");
git("config", "user.name", "e2e");
const hashLine = execFileSync("node", ["scripts/pin-hash.ts"], { cwd: root, input: `${PIN}\n`, stdio: ["pipe", "pipe", "ignore"] }).toString().trim();

const stateDir = mkdtempSync(join(tmpdir(), "hsh-setup-e2e-state-"));
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
const shot = async (page, name) => {
  if (saveShots) await page.screenshot({ path: join(shots, `setup-${name}.png`) });
};

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
const activeId = (page) => page.evaluate(() => document.activeElement?.id ?? "");
const stepText = (page) => page.locator("header p, header span").filter({ hasText: /^\s*(단계\s*)?\d\/6\s*$/ }).first().innerText();

const browser = await pw.chromium.launch();
try {
  await waitFor(`${LOCAL}/api/state`);
  const headBefore = (() => {
    try {
      return git("rev-parse", "HEAD");
    } catch {
      return "";
    }
  })();

  // ---- 태블릿: 세팅 필요 화면 + QR ----
  const tabletCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tablet = await tabletCtx.newPage();
  await tablet.goto(LOCAL);
  await tablet.getByText("가족 세팅이 필요해요").waitFor();
  const qr = await (await tabletCtx.request.get(`${LOCAL}/api/setup-qr`)).json();
  assert.equal(qr.ok, true);
  assert.equal((await (await tabletCtx.request.get(`${LOCAL}/api/state`)).json()).needsSetup, true);
  ok("빈 위키: 태블릿은 세팅 필요 + QR");

  // ---- 휴대폰: 세션 없이는 마법사/API 거부 ----
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  assert.equal((await phoneCtx.request.get(`${BASE}/setup`)).status(), 403);
  const complete = (ctx, data, headers = {}) => ctx.request.post(`${BASE}/api/setup/complete`, { data, headers: { origin: BASE, ...headers }, maxRedirects: 0 });
  assert.equal((await complete(phoneCtx, { setup: {} })).status(), 401);
  ok("세션 없으면 /setup 403, 완료 API 401");

  // ---- QR -> PIN -> 1단계 ----
  await phone.goto(qr.url);
  await phone.getByLabel("관리자 PIN").fill(PIN);
  await shot(phone, "0-pin");
  await phone.getByRole("button", { name: "확인" }).click();
  await phone.getByRole("heading", { name: "우리 집" }).waitFor();
  ok("QR -> PIN -> 마법사 1단계");

  // 세션은 있지만 출처가 다르거나 형식이 틀리면 거부
  assert.equal((await complete(phoneCtx, { setup: {} }, { origin: "http://evil.example" })).status(), 403);
  assert.equal((await phoneCtx.request.post(`${BASE}/api/setup/complete`, { form: { a: "b" }, headers: { origin: BASE } })).status(), 415);
  assert.equal((await phoneCtx.request.post(`${BASE}/api/setup/complete`, { data: `{"setup":"${"x".repeat(40000)}"}`, headers: { origin: BASE, "content-type": "application/json" } })).status(), 413);
  assert.equal((await phoneCtx.request.post(`${BASE}/api/setup/complete`, { data: "{broken", headers: { origin: BASE, "content-type": "application/json" } })).status(), 400);
  const bad = await complete(phoneCtx, { setup: { config: { familyName: "x", timezone: "Asia/Seoul", familyColor: "gray" }, members: [], anniversaries: [] } });
  assert.equal(bad.status(), 422);
  assert.ok((await bad.json()).issues.length > 0);
  assert.equal((await complete(phoneCtx, { nope: 1 })).status(), 400);
  assert.equal(await tabletCtx.request.get(`${LOCAL}/api/state`).then((r) => r.json()).then((j) => j.needsSetup), true);
  ok("완료 API: 출처 403, 형식 415, 큰 본문 413, 깨진 JSON 400, 검증 실패 422, 모양 400 - 위키는 그대로");

  // ---- 1단계 ----
  assert.equal((await stepText(phone)).replace(/\s+/g, ""), "단계1/6");
  assert.equal(await phone.locator('[data-testid="skin-preview"]').count(), 0);
  await phone.getByLabel("가족 이름").fill("햇살네");
  await phone.getByRole("button", { name: "다음" }).click();
  await phone.getByText("지역을 골라 주세요", { exact: true }).last().waitFor();
  assert.equal(await phone.getByLabel("사는 지역").getAttribute("aria-invalid"), "true");
  assert.match((await phone.getByLabel("사는 지역").getAttribute("aria-describedby")) ?? "", /f-region-error/);
  assert.equal(await activeId(phone), "f-region", "첫 오류 필드로 포커스");
  await assertLayout(phone, "1단계(오류)");
  await shot(phone, "1-home-error");
  await phone.getByLabel("사는 지역").selectOption("seoul-mapo");
  assert.equal(await phone.locator("#f-region-error").count(), 0, "고치면 오류가 바로 사라짐");
  await assertLayout(phone, "1단계");
  await shot(phone, "1-home");
  // 직접 입력(고급)
  await phone.getByRole("button", { name: /직접 입력/ }).click();
  await phone.getByLabel("nx (격자 X)").fill("0");
  await phone.getByRole("button", { name: "다음" }).click();
  await phone.getByText(/nx는 1~149/).waitFor();
  await phone.getByRole("button", { name: "목록에서 고르기" }).click();
  assert.equal(await phone.getByLabel("사는 지역").inputValue(), "seoul-mapo");
  await phone.getByRole("button", { name: "다음" }).click();
  ok("1단계: 이름·지역 검증, 오류 포커스·aria, 직접 입력 오류, 48px, 가로 넘침 없음");

  // ---- 2단계 ----
  await phone.getByRole("heading", { name: "구성원 추가" }).waitFor();
  assert.equal(await activeId(phone), "step-title", "단계가 바뀌면 제목으로 포커스");
  assert.equal((await stepText(phone)).replace(/\s+/g, ""), "단계2/6");
  // 이전으로 1단계에 돌아와도 제목으로 포커스, 다시 다음으로 2단계
  await phone.getByRole("button", { name: "이전" }).click();
  await phone.getByRole("heading", { name: "우리 집" }).waitFor();
  assert.equal(await activeId(phone), "step-title", "이전으로 1단계에 와도 제목으로 포커스");
  await phone.getByRole("button", { name: "다음" }).click();
  await phone.getByRole("heading", { name: "구성원 추가" }).waitFor();
  assert.equal(await activeId(phone), "step-title");
  await phone.getByRole("button", { name: "다음" }).click(); // 이름 비어 있음
  await phone.getByText("이름을(를) 입력해 주세요").waitFor();
  assert.equal(await activeId(phone), "f-member-m1-name");
  // 오류 필드가 하단 고정 버튼에 가리지 않는다 (WCAG 2.4.11)
  const covered = await phone.evaluate(() => {
    const a = document.activeElement?.getBoundingClientRect();
    const f = document.querySelector('[data-testid="setup-footer"]')?.getBoundingClientRect();
    return Boolean(a && f && a.bottom > f.top);
  });
  assert.equal(covered, false, "포커스된 입력이 하단 버튼에 가림");
  await phone.getByLabel("이름").fill("엄마");
  await phone.getByLabel("생일").fill("1988-03-12");
  await phone.getByRole("button", { name: /구성원 추가/ }).click();
  assert.equal(await activeId(phone), "f-member-m2-name", "추가한 카드의 이름 칸으로 포커스");
  await phone.locator("#f-member-m2-name").fill("하늘");
  await phone.locator("#f-member-m2-birth").fill("2020-08-15");
  await phone.locator("label", { hasText: "아이" }).last().click();
  // 색: 서로 겹치지 않게 자동 추천
  const c1 = await phone.locator("fieldset").nth(0).locator('input[type=radio][name]:checked').evaluateAll((els) => els.map((e) => e.value));
  const c2 = await phone.locator("fieldset").nth(1).locator('input[type=radio][name]:checked').evaluateAll((els) => els.map((e) => e.value));
  const colors1 = c1.filter((v) => !["guardian", "child"].includes(v));
  const colors2 = c2.filter((v) => !["guardian", "child"].includes(v));
  assert.deepEqual([colors1, colors2], [["coral"], ["teal"]]);
  await phone.getByText("가족 전체 (@family)").waitFor();
  await phone.getByText("기본 · 삭제할 수 없어요").waitFor();
  // id 자동 생성(한글이라 member-N) + 직접 고친 id 충돌
  await phone.getByText("위키 id: member-1").waitFor();
  await phone.getByText("위키 id: member-2").waitFor();
  await phone.locator("summary", { hasText: "위키 id: member-2" }).click();
  await phone.locator("#f-member-m2-id").fill("MEMBER-1");
  await phone.getByRole("button", { name: "다음" }).click();
  await phone.getByText("다른 구성원과 같은 id예요").waitFor();
  assert.equal(await activeId(phone), "f-member-m2-id");
  await phone.locator("#f-member-m2-id").fill("");
  assert.equal(await phone.locator("#f-member-m2-id").inputValue(), "member-2", "비우면 자동 id로");
  await phone.locator("#f-member-m2-id").fill("haneul");
  await assertLayout(phone, "2단계");
  await phone.evaluate(() => window.scrollTo(0, 0));
  await shot(phone, "2-members");
  await phone.getByRole("button", { name: "다음" }).click();
  ok("2단계: 이름/id 검증, 색 자동 추천(coral, teal), 한글→member-N, id 충돌·비우면 자동, 가족 전체 고정, 포커스");

  // ---- 3단계: 슬랙 연결 ----
  await phone.getByRole("heading", { name: "슬랙 연결" }).waitFor();
  await phone.getByText(/6자리 연결 코드를 받아/).waitFor();
  assert.equal(await phone.locator("[aria-label*='연결 코드는 아직']").count(), 2, "처음에는 코드 자리만");
  assert.equal(await phone.getByRole("button", { name: "건너뛰기" }).count(), 1, "아무것도 안 하면 건너뛰기");
  await assertLayout(phone, "3단계(코드 받기 전)");
  await shot(phone, "3-slack");

  // 코드 API 방어(세션이 있는 phoneCtx 기준): 출처 403, 형식 415, 큰 본문 413, 모양 422, 세션 없음 401
  const connectApi = (ctx, path, data, headers = {}) => ctx.request.post(`${BASE}/api/setup/connect${path}`, { data, headers: { origin: BASE, ...headers }, maxRedirects: 0 });
  for (const path of ["", "/status", "/revoke"]) {
    assert.equal((await connectApi(phoneCtx, path, {}, { origin: "http://evil.example" })).status(), 403, `${path} 출처`);
    assert.equal((await phoneCtx.request.post(`${BASE}/api/setup/connect${path}`, { form: { a: "b" }, headers: { origin: BASE } })).status(), 415, `${path} 형식`);
    assert.equal((await phoneCtx.request.post(`${BASE}/api/setup/connect${path}`, { data: `{"x":"${"y".repeat(2000)}"}`, headers: { origin: BASE, "content-type": "application/json" } })).status(), 413, `${path} 큰 본문`);
    assert.equal((await phoneCtx.request.post(`${BASE}/api/setup/connect${path}`, { data: Buffer.from("{broken"), headers: { origin: BASE, "content-type": "application/json" } })).status(), 400, `${path} 깨진 JSON`);
    assert.equal((await connectApi(phoneCtx, path, { nope: 1 })).status(), 422, `${path} 모양`);
    const anon = await browser.newContext();
    assert.equal((await connectApi(anon, path, {})).status(), 401, `${path} 세션 없음`);
    await anon.close();
  }
  assert.equal((await connectApi(phoneCtx, "", { memberKey: "mx", name: "x", role: "guardian", slackId: "UFORGED" })).status(), 422, "여분 필드 거부");
  ok("코드 API: 출처 403, 형식 415, 큰 본문 413, 깨진 JSON 400, 모양 422, 세션 없음 401");

  // 코드 받기 -> 표시 -> DM 안내
  await phone.getByRole("button", { name: "엄마 연결 코드 받기" }).click();
  const codeEl = phone.locator("[aria-label^='연결 코드 ']").first();
  await codeEl.waitFor();
  const momCode = (await codeEl.innerText()).trim();
  assert.match(momCode, /^\d{6}$/);
  await phone.getByText(`연결 ${momCode}`).waitFor();
  const focusedLabel = () => phone.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  assert.equal(await focusedLabel(), "엄마 연결 코드 다시 받기", "코드를 받은 뒤에도 포커스가 같은 버튼에 남는다(글자만 바뀜)");
  await phone.getByRole("button", { name: "엄마 연결 코드 다시 받기" }).waitFor();
  assert.equal(await phone.getByRole("button", { name: "건너뛰기" }).count(), 0, "코드를 받으면 '다음'");
  await assertLayout(phone, "3단계(코드 표시)");
  await shot(phone, "3-slack-code");
  // 다시 받기: 새 코드, 이전 코드는 무효
  await phone.getByRole("button", { name: "엄마 연결 코드 다시 받기" }).click();
  await phone.waitForFunction((old) => document.querySelector("[aria-label^='연결 코드 ']")?.textContent?.trim() !== old, momCode);
  const momCode2 = (await codeEl.innerText()).trim();
  assert.notEqual(momCode2, momCode);
  const statusOf = async (codes) => (await (await connectApi(phoneCtx, "/status", { codes })).json()).states;
  assert.deepEqual(await statusOf([momCode, momCode2]), { [momCode]: "expired", [momCode2]: "pending" });

  // 새로고침해도 코드가 남는다(draft)
  await phone.reload();
  await phone.getByRole("heading", { name: "슬랙 연결" }).waitFor();
  assert.equal((await phone.locator("[aria-label^='연결 코드 ']").first().innerText()).trim(), momCode2);

  // 봇이 DM을 받은 것처럼 사용 처리 -> 폴링으로 '연결됨'. 상태 응답에 슬랙 ID는 없다
  const claim = (code, slackId) => {
    const r = spawnSync("tsx", [join(root, "e2e/connect-claim.ts"), stateDir, code, slackId], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`claim 도우미 실패(tsx 필요): ${r.stderr}`);
    return JSON.parse(r.stdout.trim());
  };
  assert.deepEqual(claim(momCode, "UOLDONE1"), { ok: false, reason: "invalid" }, "무효가 된 이전 코드");
  assert.deepEqual(claim(momCode2, "U0123ABC"), { ok: true });
  assert.deepEqual(claim(momCode2, "U9999ZZZ"), { ok: false, reason: "invalid" }, "두 번째는 실패");
  await phone.getByText(/✓ 연결됨/).waitFor({ timeout: 15_000 });
  assert.match(await phone.locator("[role=status]").filter({ hasText: "연결됐어요" }).innerText(), /엄마 님이 슬랙에 연결됐어요/, "aria-live 알림");
  assert.ok(!JSON.stringify(await statusOf([momCode2])).includes("U0123ABC"), "슬랙 ID는 브라우저로 나가지 않는다");
  assert.ok(!(await phone.content()).includes("U0123ABC"));
  assert.equal(await phone.getByRole("button", { name: "다음" }).count(), 1);
  // 연결됨 줄에도 '연결 풀고 다시 받기': 새 코드, 이전 연결은 풀려서 같은 슬랙 계정이 다시 연결할 수 있다
  await phone.getByRole("button", { name: "엄마 연결 풀고 코드 다시 받기" }).click();
  await phone.getByRole("button", { name: "엄마 연결 코드 다시 받기" }).waitFor();
  assert.equal(await focusedLabel(), "엄마 연결 코드 다시 받기", "연결됨 줄에서 눌러도 포커스가 같은 버튼에 남는다");
  const momCode3 = (await codeEl.innerText()).trim();
  assert.notEqual(momCode3, momCode2);
  assert.deepEqual(await statusOf([momCode2, momCode3]), { [momCode2]: "expired", [momCode3]: "pending" });
  assert.deepEqual(claim(momCode3, "U0123ABC"), { ok: true }, "풀린 계정은 다시 연결할 수 있다");
  await phone.getByText(/✓ 연결됨/).waitFor({ timeout: 15_000 });
  // 아이는 아무것도 안 하고(건너뛰고) 지나간다. 코드를 받기만 하고 DM을 안 보낸 구성원도 허용(완료 시 '연결 못 함'으로 안내)
  await phone.getByRole("button", { name: "하늘 연결 코드 받기" }).click();
  await phone.getByText("30분 안에 보내야 해요").waitFor();
  await assertLayout(phone, "3단계(연결됨)");
  await shot(phone, "3-slack-connected");
  await phone.getByRole("button", { name: "다음" }).click();
  ok("3단계: 코드 받기·다시 받기(이전 코드 무효)·새로고침 유지·claim -> 연결됨(aria-live)·슬랙 ID 비노출");

  // ---- 4단계 ----
  await phone.getByRole("heading", { name: "기념일", exact: true }).waitFor();
  await phone.getByText("엄마 생일", { exact: true }).waitFor();
  await phone.getByText("하늘 생일", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "결혼기념일 추가" }).click();
  assert.equal(await phone.locator("#f-anniv-a3-title").inputValue(), "결혼기념일");
  await phone.locator("#f-anniv-a3-date").selectOption("4");
  await phone.locator("#f-anniv-a3-date-day").selectOption("31");
  await phone.getByRole("button", { name: "다음" }).click();
  await phone.getByText("월·일을 확인해 주세요").waitFor();
  assert.equal(await activeId(phone), "f-anniv-a3-date");
  await phone.locator("#f-anniv-a3-date").selectOption("11");
  await phone.locator("#f-anniv-a3-date-day").selectOption("21");
  await assertLayout(phone, "4단계");
  await shot(phone, "4-anniversaries");
  await phone.getByRole("button", { name: "다음" }).click();
  ok("4단계: 생일 자동 미리보기, 결혼기념일 추가, 없는 날짜(4/31) 오류");

  // ---- 5단계 ----
  await phone.getByRole("heading", { name: /구글 캘린더/ }).waitFor();
  assert.equal(await phone.getByRole("button", { name: "연결 테스트" }).isDisabled(), true);
  await phone.getByText(/#11/).waitFor();
  await phone.getByLabel("구글 캘린더 ID").fill("primary");
  await phone.getByRole("button", { name: "다음" }).click();
  await phone.getByText(/메일 주소 모양/).last().waitFor();
  assert.equal(await activeId(phone), "f-calendarId");
  await phone.getByLabel("구글 캘린더 ID").fill("");
  await assertLayout(phone, "5단계");
  await shot(phone, "5-calendar");
  await phone.getByRole("button", { name: "건너뛰기" }).click();
  ok("5단계: ID 형식 검증, 연결 테스트 비활성(#11 안내), 건너뛰기");

  // ---- 6단계 ----
  await phone.getByRole("heading", { name: "확인하고 시작하기" }).waitFor();
  await phone.getByText("햇살네", { exact: true }).first().waitFor();
  await phone.getByText("서울특별시 마포구").first().waitFor();
  const preview = phone.getByTestId("dashboard-preview");
  await preview.waitFor();
  await phone.getByText("햇살네").nth(1).waitFor(); // 미리보기 안의 대시보드 제목
  const box = await preview.boundingBox();
  assert.ok(box && box.width <= 390 && box.height > 100 && box.height < 400, `미리보기 크기 ${JSON.stringify(box)}`);
  assert.equal(await preview.getAttribute("aria-hidden"), "true");
  await assertLayout(phone, "6단계");
  await phone.evaluate(() => window.scrollTo(0, 0));
  await shot(phone, "6-review-top");
  await preview.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(phone, "6-review-preview");
  ok("6단계: 요약 + 축소 대시보드 미리보기(390px 안)");

  // 새로고침해도 입력이 남는다(sessionStorage)
  await phone.reload();
  await phone.getByRole("heading", { name: "확인하고 시작하기" }).waitFor();
  await phone.getByText("햇살네", { exact: true }).first().waitFor();
  ok("새로고침 후에도 6단계·입력 유지");
  await phone.getByRole("button", { name: "이전" }).click();
  await phone.getByRole("heading", { name: /구글 캘린더/ }).waitFor();
  await phone.getByRole("button", { name: "건너뛰기" }).click();

  // 완료 직전 세션 쿠키를 보관(나중에 '훔친 쿠키' 재사용 시험)
  const sessionCookie = (await phoneCtx.cookies()).find((c) => c.name === "hsh_session");
  assert.ok(sessionCookie);

  // ---- 시작하기 ----
  await phone.getByRole("button", { name: "시작하기" }).click();
  await phone.getByRole("heading", { name: "세팅 완료!" }).waitFor();
  await phone.getByText("태블릿이 곧 대시보드로 바뀝니다").waitFor();
  await phone.getByText(/슬랙에 연결된 1명/).waitFor();
  await phone.getByText(/연결을 끝내지 못한 구성원: 하늘/).waitFor();
  await shot(phone, "7-done");
  ok("시작하기 -> 완료 화면");

  // ---- 위키 확인 ----
  const subjects = git("log", "--format=%s").split("\n");
  assert.equal(subjects.length - (headBefore ? 1 : 0), 1, "커밋 하나");
  assert.equal(subjects[0], "[setup] 세팅 완료: 햇살네 (구성원 2명, 기념일 3건)");
  const changed = git("show", "--name-only", "--format=", "HEAD").split("\n").sort();
  assert.deepEqual(changed, ["anniversaries.md", "config.md", "log.md", "members/haneul.md", "members/member-1.md"]);
  const config = readFileSync(join(wiki, "config.md"), "utf8");
  for (const line of ["familyName: 햇살네", "timezone: Asia/Seoul", "region: 서울특별시 마포구", "kmaNx: 59", "kmaNy: 127", "kmaMidLandRegId: 11B00000", "kmaMidTaRegId: 11B10101", "familyColor: gray"]) assert.ok(config.includes(line), line);
  assert.match(config, /setupCompletedAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00/);
  assert.ok(!config.includes("calendarId"));
  const mom = readFileSync(join(wiki, "members/member-1.md"), "utf8");
  for (const line of ["id: member-1", "name: 엄마", "role: guardian", "birth: 1988-03-12", "color: coral"]) assert.ok(mom.includes(line), line);
  const kid = readFileSync(join(wiki, "members/haneul.md"), "utf8");
  for (const line of ["id: haneul", "name: 하늘", "role: child", "birth: 2020-08-15", "color: teal"]) assert.ok(kid.includes(line), line);
  assert.equal(readFileSync(join(wiki, "anniversaries.md"), "utf8"), "- 03-12 엄마 생일 @member-1\n- 08-15 하늘 생일 @haneul\n- 11-21 결혼기념일 @family\n");
  assert.ok(existsSync(join(wiki, "log.md")));
  assert.match(mom, /^slack: U0123ABC$/m, "서버가 연결 기록의 슬랙 ID를 member 파일에 씀");
  assert.ok(!kid.includes("slack:"), "연결을 끝내지 못한 구성원은 슬랙 ID 없음");
  assert.deepEqual(existsSync(join(stateDir, "connect")) ? readdirSync(join(stateDir, "connect")) : [], [], "완료 후 setup 연결 코드는 모두 폐기");
  assert.equal(git("status", "--porcelain"), "");
  ok("위키: 커밋 하나, config/members/anniversaries/log 내용 확인, 작업 트리 깨끗");

  // ---- /api/state, 세션·토큰 폐기 ----
  const state = await (await tabletCtx.request.get(`${LOCAL}/api/state`)).json();
  assert.equal(state.needsSetup, false);
  assert.equal(state.familyName, "햇살네");
  assert.deepEqual(state.members.map((m) => m.id), ["member-1", "haneul", "family"]);
  assert.ok(!JSON.stringify(state).includes("1988-03-12"), "생일 원문은 공개 응답에 없음");
  assert.equal((await phoneCtx.cookies()).find((c) => c.name === "hsh_session"), undefined, "세션 쿠키 삭제");
  assert.equal((await phoneCtx.request.get(`${BASE}/setup`)).status(), 403);
  assert.equal((await complete(phoneCtx, { setup: {} })).status(), 401);
  assert.equal((await tabletCtx.request.get(`${LOCAL}/api/setup-qr`)).status(), 404, "세팅이 끝나면 새 토큰을 내보내지 않음");
  assert.equal((await tabletCtx.request.get(qr.url)).status(), 403, "이전 QR 토큰 무효");
  // 쿠키를 훔쳐 다시 써도 세팅 끝난 위키는 쓰지 않는다(409), 마법사도 안 열린다
  await phoneCtx.addCookies([sessionCookie]);
  const again = await complete(phoneCtx, { setup: { config: { familyName: "다시", timezone: "Asia/Seoul", familyColor: "gray" }, members: [{ id: "x", name: "x", role: "guardian", color: "coral" }], anniversaries: [] } });
  assert.equal(again.status(), 409);
  assert.equal((await connectApi(phoneCtx, "", { memberKey: "m9", name: "x", role: "guardian" })).status(), 409, "세팅이 끝난 뒤 코드 발급은 409");
  assert.equal((await connectApi(phoneCtx, "/status", { codes: ["123456"] })).status(), 409, "세팅이 끝난 뒤 상태 조회도 409");
  assert.equal((await again.json()).code, "already_done");
  await phone.goto(`${BASE}/setup`);
  await phone.getByText("이미 세팅이 끝났어요").waitFor();
  assert.equal(git("log", "--format=%s").split("\n").length, subjects.length, "커밋이 늘지 않음");
  ok("/api/state needsSetup=false, 세션·토큰 폐기, 재사용 쿠키는 409/마법사 닫힘");

  // ---- 태블릿이 폴링으로 대시보드로 바뀜 ----
  if (!process.env.SKIP_TABLET_WAIT) {
    await tablet.getByText("가족 세팅이 필요해요").waitFor({ state: "detached", timeout: 15_000 });
    await tablet.getByText("햇살네").first().waitFor();
    if (saveShots) await tablet.screenshot({ path: join(shots, "setup-8-tablet-after.png") });
    ok("태블릿이 15초 안에 대시보드로 전환(세팅 화면은 5초 폴링)");
  }
} finally {
  await browser.close();
  server.kill();
}
console.log("모두 통과");
