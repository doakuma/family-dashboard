import { describe, expect, it } from "vitest";
import { findRegion, regionToConfigFields } from "../regions";
import { settingsChangeSchema } from "../schema";
import type { SettingsChange } from "../types";
import type { WikiFiles } from "./apply";
import { parseConfigFile, parseMemberFile } from "./format";
import { updateFrontmatterValues } from "./frontmatter";
import { SettingsError, buildSettingsFiles } from "./settings";

const filesOf = (m: Record<string, string>): WikiFiles => ({
  read: (p) => m[p],
  list: (dir) => Object.keys(m).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)).sort(),
});

const CONFIG = "---\nfamilyName: 햇살네\ntimezone: Asia/Seoul\nregion: 서울특별시 마포구\nkmaNx: 59\nkmaNy: 127\nkmaMidLandRegId: 11B00000\nkmaMidTaRegId: 11B10101\nfamilyColor: gray\nsetupCompletedAt: 2026-10-30T20:00:00+09:00\n---\n";
const wiki = (extra: Record<string, string> = {}) => ({
  "config.md": CONFIG,
  "members/mom.md": "---\nid: mom\nname: 엄마\nrole: guardian\ncolor: coral\nslack: U0MOM\n---\n",
  "members/haneul.md": "<!-- 하늘이 파일 -->\n---\nid: haneul\nname: 하늘\nrole: child\ncolor: blue\nnickname: 하늘이\n# 메모\n---\n\n## 메모\n좋아하는 것: 공룡\n",
  ...extra,
});
const run = (change: SettingsChange | unknown, files: Record<string, string> = wiki()) => buildSettingsFiles(filesOf(files), change);
const fails = (change: unknown, code: SettingsError["code"], files: Record<string, string> = wiki()) => {
  try {
    run(change, files);
  } catch (e) {
    expect(e).toBeInstanceOf(SettingsError);
    expect((e as SettingsError).code).toBe(code);
    return e as SettingsError;
  }
  throw new Error("거부되지 않았어요");
};

describe("member.color", () => {
  it("색만 바꾸고 다른 키·주석·본문은 그대로 둔다", () => {
    const r = run({ kind: "member.color", payload: { id: "haneul", color: "green" } });
    expect([...r.files.keys()]).toEqual(["members/haneul.md"]);
    expect(r.files.get("members/haneul.md")).toBe("<!-- 하늘이 파일 -->\n---\nid: haneul\nname: 하늘\nrole: child\ncolor: green\nnickname: 하늘이\n# 메모\n---\n\n## 메모\n좋아하는 것: 공룡\n");
    expect(r.summary).toBe("하늘 색: 파랑 → 초록");
    expect(r.id).toBe("haneul");
  });
  it("결과 파일을 다시 읽으면 새 색", () => {
    const r = run({ kind: "member.color", payload: { id: "mom", color: "purple" } });
    expect(parseMemberFile(r.files.get("members/mom.md") ?? "")).toMatchObject({ id: "mom", color: "purple", slackId: "U0MOM", role: "guardian" });
  });
  it("다른 구성원과 같은 색도 허용(마법사 규칙과 같다)", () => {
    expect(() => run({ kind: "member.color", payload: { id: "haneul", color: "coral" } })).not.toThrow();
  });
  it("이미 같은 색 -> conflict, 없는 구성원 -> not_found, 목록 밖 색·gray·hex -> invalid", () => {
    fails({ kind: "member.color", payload: { id: "mom", color: "coral" } }, "conflict");
    fails({ kind: "member.color", payload: { id: "nobody", color: "green" } }, "not_found");
    fails({ kind: "member.color", payload: { id: "family", color: "green" } }, "not_found");
    for (const color of ["gray", "#ff0000", "red", ""]) fails({ kind: "member.color", payload: { id: "mom", color } }, "invalid");
  });
  it("파일 이름과 id가 달라도 id로 찾는다", () => {
    const r = run({ kind: "member.color", payload: { id: "dad", color: "green" } }, wiki({ "members/아빠.md": "---\nid: dad\nname: 아빠\nrole: guardian\ncolor: teal\n---\n" }));
    expect([...r.files.keys()]).toEqual(["members/아빠.md"]);
  });
});

describe("member.slack", () => {
  it("연결: slack 줄을 더하고, 로그 요약에 슬랙 ID가 없다", () => {
    const r = run({ kind: "member.slack", payload: { id: "haneul", slackId: "U0HANEUL" } });
    expect(r.files.get("members/haneul.md")).toContain("\nslack: U0HANEUL\n");
    expect(r.files.get("members/haneul.md")).toContain("nickname: 하늘이");
    expect(r.summary).toBe("하늘 슬랙: 연결");
    expect(r.summary).not.toContain("U0HANEUL");
  });
  it("다른 계정으로 다시 연결", () => {
    const r = run({ kind: "member.slack", payload: { id: "mom", slackId: "U0NEW" } });
    expect(r.files.get("members/mom.md")).toContain("slack: U0NEW");
    expect(r.files.get("members/mom.md")).not.toContain("U0MOM");
    expect(r.summary).toBe("엄마 슬랙: 다른 계정으로 다시 연결");
  });
  it("해제: slack 줄을 지운다", () => {
    const r = run({ kind: "member.slack", payload: { id: "mom", slackId: null } });
    expect(r.files.get("members/mom.md")).toBe("---\nid: mom\nname: 엄마\nrole: guardian\ncolor: coral\n---\n");
    expect(r.summary).toBe("엄마 슬랙: 연결 해제");
  });
  it("같은 slackId가 다른 구성원에 있으면 conflict", () => {
    const e = fails({ kind: "member.slack", payload: { id: "haneul", slackId: "U0MOM" } }, "conflict");
    expect(e.message).toContain("엄마");
    expect(e.message).not.toContain("U0MOM");
  });
  it("이미 같은 계정·연결 안 된 구성원의 해제 -> conflict, 없는 구성원 -> not_found, 이상한 ID -> invalid", () => {
    fails({ kind: "member.slack", payload: { id: "mom", slackId: "U0MOM" } }, "conflict");
    fails({ kind: "member.slack", payload: { id: "haneul", slackId: null } }, "conflict");
    fails({ kind: "member.slack", payload: { id: "nobody", slackId: "U1" } }, "not_found");
    fails({ kind: "member.slack", payload: { id: "mom", slackId: "U 1\n" } }, "invalid");
  });
});

describe("member.add", () => {
  it("id를 생략하면 이름으로 만든다(한글은 member-N)", () => {
    const r = run({ kind: "member.add", payload: { name: "할머니", role: "guardian", color: "pink" } });
    expect([...r.files.keys()]).toEqual(["members/member-1.md"]);
    expect(parseMemberFile(r.files.get("members/member-1.md") ?? "")).toEqual({ id: "member-1", name: "할머니", role: "guardian", color: "pink", birth: undefined, slackId: undefined });
    expect(r.summary).toBe("구성원 추가: 할머니 (보호자, 분홍)");
  });
  it("영문 이름은 slug, 겹치면 -2", () => {
    expect([...run({ kind: "member.add", payload: { name: "Dad", role: "guardian", color: "teal" } }).files.keys()]).toEqual(["members/dad.md"]);
    expect([...run({ kind: "member.add", payload: { name: "Mom", role: "guardian", color: "teal" } }).files.keys()]).toEqual(["members/mom-2.md"]);
  });
  it("id 중복(대소문자 무시)·family·Windows 예약어는 거부", () => {
    fails({ kind: "member.add", payload: { id: "MOM", name: "또엄마", role: "child", color: "teal" } }, "conflict");
    fails({ kind: "member.add", payload: { id: "family", name: "가족", role: "child", color: "teal" } }, "invalid");
    fails({ kind: "member.add", payload: { id: "con", name: "씨", role: "child", color: "teal" } }, "invalid");
  });
  it("파서가 건너뛴 구성원 파일의 이름도 쓰인 것으로 본다", () => {
    fails({ kind: "member.add", payload: { id: "broken", name: "깨짐", role: "child", color: "teal" } }, "conflict", wiki({ "members/Broken.md": "내용 없음" }));
  });
  it("구성원이 12명이면 더 못 넣고, 11명이면 넣는다", () => {
    const more = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`members/m${i}.md`, `---\nid: m${i}\nname: 사람${i}\nrole: child\ncolor: blue\n---\n`]));
    const add = { kind: "member.add", payload: { name: "새사람", role: "child", color: "teal" } };
    expect(() => run(add, wiki(more(9)))).not.toThrow();
    fails(add, "conflict", wiki(more(10)));
  });
  it("이름·역할·색 검증, 여분 필드(slackId 등) 거부", () => {
    fails({ kind: "member.add", payload: { name: "", role: "child", color: "teal" } }, "invalid");
    fails({ kind: "member.add", payload: { name: "\"따옴표\"", role: "child", color: "teal" } }, "invalid");
    fails({ kind: "member.add", payload: { name: "줄\n바꿈", role: "child", color: "teal" } }, "invalid");
    fails({ kind: "member.add", payload: { name: "삼촌", role: "owner", color: "teal" } }, "invalid");
    fails({ kind: "member.add", payload: { name: "삼촌", role: "child", color: "gray" } }, "invalid");
    fails({ kind: "member.add", payload: { name: "삼촌", role: "child", color: "teal", slackId: "U1" } }, "invalid");
  });
});

describe("config.region", () => {
  const gangnam = regionToConfigFields(findRegion("seoul-gangnam")!);
  it("지역 다섯 줄만 바꾸고 나머지는 그대로", () => {
    const r = run({ kind: "config.region", payload: gangnam });
    const text = r.files.get("config.md") ?? "";
    expect(parseConfigFile(text)).toMatchObject({ familyName: "햇살네", region: gangnam.region, kmaNx: gangnam.kmaNx, kmaNy: gangnam.kmaNy, setupCompletedAt: "2026-10-30T20:00:00+09:00", familyColor: "gray" });
    expect(text.split("\n").filter((l) => !/^(region|kmaNx|kmaNy):/.test(l))).toEqual(CONFIG.split("\n").filter((l) => !/^(region|kmaNx|kmaNy):/.test(l)));
    expect(r.summary).toBe(`지역: 서울특별시 마포구 → ${gangnam.region}`);
  });
  it("지역 줄이 없던 config에는 줄을 더한다", () => {
    const bare = "---\nfamilyName: 햇살네\ntimezone: Asia/Seoul\nfamilyColor: gray\n---\n";
    const text = run({ kind: "config.region", payload: gangnam }, wiki({ "config.md": bare })).files.get("config.md") ?? "";
    expect(parseConfigFile(text)).toMatchObject({ region: gangnam.region, kmaNx: gangnam.kmaNx, kmaMidTaRegId: gangnam.kmaMidTaRegId });
  });
  it("같은 지역 -> conflict, 네 값 중 하나라도 빠지거나 범위 밖 -> invalid", () => {
    fails({ kind: "config.region", payload: { region: "서울특별시 마포구", kmaNx: 59, kmaNy: 127, kmaMidLandRegId: "11B00000", kmaMidTaRegId: "11B10101" } }, "conflict");
    fails({ kind: "config.region", payload: { ...gangnam, kmaNy: undefined } }, "invalid");
    fails({ kind: "config.region", payload: { ...gangnam, kmaNx: 999 } }, "invalid");
    fails({ kind: "config.region", payload: { ...gangnam, kmaMidLandRegId: "서울" } }, "invalid");
  });
});

describe("공통 거부", () => {
  it("세팅 전(config 없음·구성원 없음)이면 needs_setup", () => {
    fails({ kind: "member.color", payload: { id: "mom", color: "green" } }, "needs_setup", {});
    fails({ kind: "member.color", payload: { id: "mom", color: "green" } }, "needs_setup", { "config.md": CONFIG });
  });
  it("모르는 kind·빈 입력 -> invalid", () => {
    fails({ kind: "member.remove", payload: { id: "mom" } }, "invalid");
    fails(undefined, "invalid");
    fails({ kind: "member.color" }, "invalid");
  });
  it("스키마가 SettingsChange 모양과 맞는다", () => {
    expect(settingsChangeSchema.safeParse({ kind: "member.slack", payload: { id: "mom", slackId: null } }).success).toBe(true);
  });
});

describe("updateFrontmatterValues", () => {
  it("CRLF를 유지한다", () => {
    expect(updateFrontmatterValues("---\r\nid: a\r\ncolor: blue\r\n---\r\n본문\r\n", { color: "green" })).toBe("---\r\nid: a\r\ncolor: green\r\n---\r\n본문\r\n");
  });
  it("프론트매터가 없으면 null, 위험한 값은 던진다", () => {
    expect(updateFrontmatterValues("본문만", { a: "1" })).toBeNull();
    expect(() => updateFrontmatterValues("---\na: 1\n---\n", { a: "x\ny" })).toThrow();
    expect(() => updateFrontmatterValues("---\na: 1\n---\n", { a: '"q"' })).toThrow();
  });
  it("값이 같으면 글이 그대로", () => {
    const t = "---\ncolor: blue\n---\n";
    expect(updateFrontmatterValues(t, { color: "blue" })).toBe(t);
  });
});
