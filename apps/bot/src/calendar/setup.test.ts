import { DEFAULT_FAMILY_ID, type Change, type ConfigProvider } from "@hsh/core";
import { EnvConfigProvider } from "@hsh/core/node";
import { createMockGoogle } from "@hsh/core/google-mock";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FsWikiRepository } from "@hsh/core/node";
import { withCalendarKick } from "./hook";
import { startCalendarSync } from "./setup";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const EMAIL = "hsh-bot@proj.iam.gserviceaccount.com";
const CAL = "family123456@group.calendar.google.com";
const tmp = () => mkdtempSync(join(tmpdir(), "hsh-cal-"));
const SAMPLE = join(__dirname, "../../../../fixtures/sample-wiki");

function wikiCopy(): string {
  const root = join(tmp(), "wiki");
  cpSync(SAMPLE, root, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("add", ".");
  git("commit", "-qm", "init");
  return root;
}
const gitOut = (root: string, ...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

describe("startCalendarSync: 설정이 없으면 꺼짐", () => {
  it("GOOGLE_SERVICE_ACCOUNT_JSON이 없으면 아무 것도 하지 않는다(타이머·요청 없음)", async () => {
    const log = vi.fn();
    const fetch = vi.fn();
    const h = await startCalendarSync({ config: new EnvConfigProvider({}), wiki: { read: vi.fn() }, familyId: DEFAULT_FAMILY_ID, fetch, log });
    expect(h).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(log.mock.calls.join()).toContain("꺼져");
  });

  it("키 파일이 없거나 깨졌으면 경고만 하고 꺼진 채로 둔다(내용은 로그에 없음)", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ client_email: EMAIL, private_key: "SECRET-NOT-A-KEY" }));
    for (const path of [join(dir, "none.json"), join(dir, "bad.json")]) {
      const warn = vi.fn();
      const h = await startCalendarSync({ config: new EnvConfigProvider({ GOOGLE_SERVICE_ACCOUNT_JSON: path }), wiki: { read: vi.fn() }, familyId: DEFAULT_FAMILY_ID, warn });
      expect(h).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).not.toMatch(/SECRET-NOT-A-KEY|hsh-bot@/);
    }
  });

  it("GOOGLE_CALENDAR_ID가 메일 주소 모양이 아니면 무시한다(값을 로그에 싣지 않음)", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "k.json"), JSON.stringify({ client_email: EMAIL, private_key: PEM }));
    const warn = vi.fn();
    const h = await startCalendarSync({
      config: new EnvConfigProvider({ GOOGLE_SERVICE_ACCOUNT_JSON: join(dir, "k.json"), GOOGLE_CALENDAR_ID: "not-an-email-XYZ", HSH_STATE_DIR: dir }),
      wiki: { read: vi.fn(async () => ({ config: undefined, events: [], members: [], warnings: [] }) as never) },
      familyId: DEFAULT_FAMILY_ID,
      warn,
      log: () => {},
      startDelayMs: 1e9,
      intervalMs: 1e9,
    });
    expect(h).toBeDefined();
    expect(warn.mock.calls.join()).not.toContain("XYZ");
    expect((await h!.reconciler.run()).status).toBe("disabled");
    h!.stop();
  });
});

describe("연결 통합: 위키 쓰기 + 캘린더 복사 (임시 위키 복사본, 목 구글)", () => {
  async function harness() {
    const wikiRoot = wikiCopy();
    const stateDir = tmp();
    const keyDir = tmp();
    writeFileSync(join(keyDir, "gcal.json"), JSON.stringify({ client_email: EMAIL, private_key: PEM }));
    const google = createMockGoogle();
    const logs: string[] = [];
    const warns: string[] = [];
    const config: ConfigProvider = new EnvConfigProvider({ GOOGLE_SERVICE_ACCOUNT_JSON: join(keyDir, "gcal.json"), GOOGLE_CALENDAR_ID: CAL, HSH_STATE_DIR: stateDir, WIKI_REPO_PATH: wikiRoot });
    const fsWiki = new FsWikiRepository({ root: wikiRoot, push: false, now: () => new Date("2026-11-10T03:00:00Z") });
    const handle = await startCalendarSync({
      config,
      wiki: fsWiki,
      files: fsWiki.files,
      familyId: DEFAULT_FAMILY_ID,
      fetch: google.fetch,
      sleep: async () => {},
      now: () => new Date("2026-11-10T03:00:00Z"),
      log: (m) => logs.push(m),
      warn: (m) => warns.push(m),
      startDelayMs: 1e9,
      intervalMs: 1e9,
    });
    const wiki = withCalendarKick(fsWiki, () => void handle!.kick());
    return { wikiRoot, stateDir, google, logs, warns, handle: handle!, wiki, config };
  }
  const ADD: Change = { kind: "event.add", payload: { date: "2026-11-20", start: "14:00", allDay: false, title: "새 일정", members: ["haneul"] } };
  const wikiEvents = (root: string) => (readFileSync(join(root, "events/2026-11.md"), "utf8").match(/#evt-/g) ?? []).length + (readFileSync(join(root, "events/2026-10.md"), "utf8").match(/#evt-/g) ?? []).length;

  it("처음에는 위키의 앞으로의 일정을 모두 복사하고, 추가·수정·삭제가 따라간다. 위키 작업 트리는 깨끗하다", async () => {
    const t = await harness();
    const first = await t.handle.reconciler.run();
    expect(first.status).toBe("ok");
    expect(first.added).toBeGreaterThan(5);
    expect(t.google.liveCount()).toBe(first.added);
    const before = t.google.liveCount();

    // 슬랙에서 일정 추가(apply) -> 복사
    const r = await t.wiki.apply(DEFAULT_FAMILY_ID, ADD);
    expect(r.version).toBeTruthy();
    await t.handle.reconciler.run();
    expect(t.google.liveCount()).toBe(before + 1);

    // 수정·삭제
    const id = (r as { id?: string }).id!;
    await t.wiki.apply(DEFAULT_FAMILY_ID, { kind: "event.update", payload: { id, title: "바뀐 일정" } });
    await t.handle.reconciler.run();
    expect([...t.google.events.values()].some((e) => e.summary === "바뀐 일정")).toBe(true);
    await t.wiki.apply(DEFAULT_FAMILY_ID, { kind: "event.remove", payload: { id } });
    await t.handle.reconciler.run();
    expect(t.google.liveCount()).toBe(before);
    expect([...t.google.events.values()].filter((e) => e.status === "cancelled")).toHaveLength(1);

    // 복사 기록은 상태 폴더에만 있고 위키 작업 트리에는 아무 것도 생기지 않는다(pull·변경 판정에 영향 없음)
    expect(gitOut(t.wikiRoot, "status", "--porcelain")).toBe("");
    expect(existsSync(join(t.wikiRoot, ".sync"))).toBe(false);
    expect(existsSync(join(t.stateDir, "calendar-sync", `${DEFAULT_FAMILY_ID}.json`))).toBe(true);
    expect(wikiEvents(t.wikiRoot)).toBeGreaterThan(5);
  });

  it("위키를 직접 고치거나 pull로 바뀐 일정도 주기 동기화가 따라간다(apply 없이)", async () => {
    const t = await harness();
    await t.handle.reconciler.run();
    const before = t.google.liveCount();
    const file = join(t.wikiRoot, "events/2026-11.md");
    writeFileSync(file, `${readFileSync(file, "utf8")}- [ ] 2026-11-25 19:00 사람이 직접 적음 @mom #evt-hand1\n`);
    await t.handle.reconciler.run();
    expect(t.google.liveCount()).toBe(before + 1);
  });

  it("캘린더가 전부 실패해도 위키 쓰기는 성공하고(커밋 남음) 대화 흐름은 그대로다. 구글이 살아나면 다음 동기화가 따라잡는다", async () => {
    const t = await harness();
    t.google.setFault(() => ({ status: 503 }));
    const r = await t.wiki.apply(DEFAULT_FAMILY_ID, ADD);
    expect(r.version).toBe(gitOut(t.wikiRoot, "rev-parse", "HEAD"));
    expect(readFileSync(join(t.wikiRoot, "events/2026-11.md"), "utf8")).toContain("새 일정");
    // 깨운 실행이 끝나길 기다린다(던지지 않음)
    const failed = await t.handle.reconciler.run();
    expect(failed.failed).toBeGreaterThan(0);
    expect(t.google.liveCount()).toBe(0);
    expect(t.warns.join("\n")).toContain("다음 동기화 때 다시");
    expect(t.warns.join("\n")).not.toContain(CAL);

    t.google.setFault(undefined);
    const ok = await t.handle.reconciler.run();
    expect(ok.failed).toBe(0);
    expect(t.google.liveCount()).toBeGreaterThan(5);
    // 로그 어디에도 키·캘린더 id가 없다
    for (const line of [...t.logs, ...t.warns]) expect(line).not.toMatch(/BEGIN PRIVATE KEY|gserviceaccount|group\.calendar\.google|mock-token/);
  });

  it("깨진 줄로 읽히지 않게 된 일정은 위키에 `#evt-…`가 남아 있으므로 구글에서 지우지 않는다(실제 파서 동작)", async () => {
    const t = await harness();
    await t.handle.reconciler.run();
    const before = t.google.liveCount();
    const file = join(t.wikiRoot, "events/2026-11.md");
    const text = readFileSync(file, "utf8");
    // 마지막 일정 줄의 시각을 망가뜨려 파서가 줄을 버리게 한다(id 토큰은 그대로)
    const lines = text.trimEnd().split("\n");
    const last = lines.length - 1;
    const id = /#(evt-[A-Za-z0-9]+)/.exec(lines[last]!)![1]!;
    lines[last] = lines[last]!.replace(/\d{2}:\d{2}/, "25:99");
    writeFileSync(file, `${lines.join("\n")}\n`);
    const wikiNow = await new FsWikiRepository({ root: t.wikiRoot, push: false }).read(DEFAULT_FAMILY_ID);
    expect(wikiNow.events.some((e) => e.id === id)).toBe(false); // 파서가 버림(경고도 없음)
    const r = await t.handle.reconciler.run();
    expect(r.removed).toBe(0);
    expect(t.google.liveCount()).toBe(before);
    expect(t.warns.join()).toContain("형식이 깨진");
    // 줄을 정말 지우면 지워진다
    writeFileSync(file, `${lines.slice(0, last).join("\n")}\n`);
    expect((await t.handle.reconciler.run()).removed).toBe(1);
  });

  it("캘린더 공유가 풀려 404가 오면 아무것도 지우지 않고 멈춘다(고아 복사본·기록 손실 없음)", async () => {
    const t = await harness();
    await t.handle.reconciler.run();
    const before = t.google.liveCount();
    const file = join(t.wikiRoot, "events/2026-11.md");
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    writeFileSync(file, `${lines.slice(0, -1).join("\n")}\n`);
    t.google.setFault((c) => (c.path !== "/token" ? { status: 404, body: { error: { errors: [{ reason: "notFound" }] } } } : undefined));
    const r = await t.handle.reconciler.run();
    expect(r.status).toBe("aborted");
    expect(r.removed).toBe(0);
    expect(t.warns.join()).toContain("일정 변경");
    t.google.setFault(undefined);
    expect((await t.handle.reconciler.run()).removed).toBe(1);
    expect(t.google.liveCount()).toBe(before - 1);
  });

  it("봇이 다시 시작돼도 기록 덕분에 중복 없이 이어진다(같은 구글 id)", async () => {
    const t = await harness();
    await t.handle.reconciler.run();
    const before = t.google.events.size;
    const again = await startCalendarSync({ config: t.config, wiki: new FsWikiRepository({ root: t.wikiRoot, push: false }), familyId: DEFAULT_FAMILY_ID, fetch: t.google.fetch, sleep: async () => {}, now: () => new Date("2026-11-10T03:00:00Z"), log: () => {}, startDelayMs: 1e9, intervalMs: 1e9 });
    const r = await again!.reconciler.run();
    expect(r).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(t.google.events.size).toBe(before);
    // 기록을 잃어도 같은 id로 덮어써 중복이 생기지 않는다
    execFileSync("rm", ["-rf", join(t.stateDir, "calendar-sync")]);
    const r3 = await again!.reconciler.run();
    expect(r3.added).toBe(before);
    expect(t.google.events.size).toBe(before);
    t.handle.stop();
    again!.stop();
  });
});
