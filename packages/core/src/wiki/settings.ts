// 세팅 뒤 설정 변경(SettingsChange) -> 위키 파일. 파일 시스템 없이 "읽기 함수 -> 바뀐 파일 목록"만 계산하는 순수 로직(setup.ts·apply.ts와 같은 구조).
// 기존 구성원·config 파일은 바꿀 키의 줄만 고친다: 모르는 키·주석·본문은 그대로 남는다(formatMemberFile로 다시 쓰지 않는다).
import { colorLabel } from "../member-colors";
import { suggestMemberId } from "../member-id";
import { SETUP_MAX_MEMBERS, settingsChangeSchema } from "../schema";
import { DEFAULT_FAMILY_ID, needsSetup, type Member, type SettingsChange } from "../types";
import type { WikiFiles } from "./apply";
import { formatMemberFile, parseMemberFile } from "./format";
import { updateFrontmatterValues } from "./frontmatter";
import { readWiki } from "./read";

export type SettingsErrorCode =
  /** 입력이 스키마를 통과하지 못했다 (HTTP 422). issues에 필드별 사유 */
  | "invalid"
  /** 없는 구성원 (HTTP 404) */
  | "not_found"
  /** 지금 상태와 맞지 않는다: id·슬랙 계정 중복, 이미 같은 값, 구성원 수 상한 (HTTP 409) */
  | "conflict"
  /** 읽기 전용 위키 (HTTP 503) */
  | "read_only"
  /** 첫 세팅 전이라 설정을 바꿀 수 없다 (HTTP 409) */
  | "needs_setup";

export interface SettingsIssue {
  path: string;
  message: string;
}

export class SettingsError extends Error {
  constructor(
    message: string,
    readonly code: SettingsErrorCode,
    readonly issues: SettingsIssue[] = [],
  ) {
    super(message);
    this.name = "SettingsError";
  }
}

export interface SettingsResult {
  /** 경로 -> 새 내용 */
  files: Map<string, string>;
  /** 커밋 메시지·log.md에 쓰는 사람이 읽는 한 줄(예: `하늘 색: 파랑 → 초록`) */
  summary: string;
  /** 만들어지거나 바뀐 구성원 id (config 변경이면 없음) */
  id?: string;
}

/** 구성원 파일 한 개: 경로와 읽은 구성원(id가 파일 이름과 다를 수 있어 파일을 열어 찾는다) */
function findMemberFile(files: WikiFiles, id: string): { path: string; text: string; member: Member } | undefined {
  for (const n of files.list("members").filter((n) => n.endsWith(".md"))) {
    const path = `members/${n}`;
    const text = files.read(path);
    const member = text ? parseMemberFile(text) : null;
    if (text && member && member.id === id) return { path, text, member };
  }
  return undefined;
}

const notFound = (id: string) => new SettingsError(`구성원 '${id}'을(를) 찾을 수 없어요`, "not_found");

/**
 * @param change 검증 전 값(외부 입력)도 받는다. 스키마를 통과해야 한다.
 */
export function buildSettingsFiles(files: WikiFiles, change: unknown): SettingsResult {
  const checked = settingsChangeSchema.safeParse(change);
  if (!checked.success) {
    const issues = checked.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new SettingsError(`올바르지 않은 설정 값이에요 (${issues.map((i) => `${i.path || "settings"}: ${i.message}`).join(", ")})`, "invalid", issues);
  }
  const c: SettingsChange = checked.data;
  const state = readWiki(files, DEFAULT_FAMILY_ID);
  if (needsSetup(state)) throw new SettingsError("첫 세팅이 끝난 뒤에 바꿀 수 있어요", "needs_setup");
  const people = state.members.filter((m) => m.id !== "family");

  switch (c.kind) {
    case "member.add": {
      const { name, role, color } = c.payload;
      if (people.length >= SETUP_MAX_MEMBERS) throw new SettingsError(`구성원은 ${SETUP_MAX_MEMBERS}명까지예요`, "conflict");
      // 파서가 건너뛴 파일도 이름을 차지하고 있다: 파일 이름(확장자 뺀 것)과 읽힌 id를 모두 쓰인 것으로 본다
      const taken = new Set([...people.map((m) => m.id), ...files.list("members").map((n) => n.replace(/\.md$/i, ""))].map((x) => x.toLowerCase()));
      const id = c.payload.id ?? suggestMemberId(name, taken);
      if (taken.has(id.toLowerCase()) || id.toLowerCase() === "family") {
        throw new SettingsError(`이미 쓰는 id예요: ${id}`, "conflict", [{ path: "payload.id", message: "이미 쓰는 id예요" }]);
      }
      return { files: new Map([[`members/${id}.md`, formatMemberFile({ id, name, role, color })]]), summary: `구성원 추가: ${name} (${role === "guardian" ? "보호자" : "아이"}, ${colorLabel(color)})`, id };
    }
    case "member.color": {
      const hit = findMemberFile(files, c.payload.id);
      if (!hit) throw notFound(c.payload.id);
      if (hit.member.color === c.payload.color) throw new SettingsError(`${hit.member.name}의 색은 이미 ${colorLabel(c.payload.color)}이에요`, "conflict");
      const text = updateFrontmatterValues(hit.text, { color: c.payload.color });
      if (text === null) throw notFound(c.payload.id);
      return {
        files: new Map([[hit.path, text]]),
        summary: `${hit.member.name} 색: ${colorLabel(hit.member.color)} → ${colorLabel(c.payload.color)}`,
        id: hit.member.id,
      };
    }
    case "member.slack": {
      const { id, slackId } = c.payload;
      const hit = findMemberFile(files, id);
      if (!hit) throw notFound(id);
      if (slackId === null) {
        if (!hit.member.slackId) throw new SettingsError(`${hit.member.name}은(는) 슬랙에 연결돼 있지 않아요`, "conflict");
      } else {
        if (hit.member.slackId === slackId) throw new SettingsError(`${hit.member.name}은(는) 이미 이 슬랙 계정으로 연결돼 있어요`, "conflict");
        const other = people.find((m) => m.id !== id && m.slackId === slackId);
        if (other) throw new SettingsError(`이 슬랙 계정은 이미 '${other.name}'에 연결돼 있어요`, "conflict", [{ path: "payload.slackId", message: "이미 다른 구성원에 연결된 계정이에요" }]);
      }
      // 슬랙 ID는 log.md·커밋 제목에 남기지 않는다(연결 여부만)
      const text = updateFrontmatterValues(hit.text, { slack: slackId ?? undefined });
      if (text === null) throw notFound(id);
      return { files: new Map([[hit.path, text]]), summary: `${hit.member.name} 슬랙: ${slackId === null ? "연결 해제" : hit.member.slackId ? "다른 계정으로 다시 연결" : "연결"}`, id: hit.member.id };
    }
    case "config.region": {
      const p = c.payload;
      const before = state.config?.region;
      const text = updateFrontmatterValues(files.read("config.md") ?? "", {
        region: p.region,
        kmaNx: p.kmaNx,
        kmaNy: p.kmaNy,
        kmaMidLandRegId: p.kmaMidLandRegId,
        kmaMidTaRegId: p.kmaMidTaRegId,
      });
      if (text === null) throw new SettingsError("config.md를 읽을 수 없어요", "needs_setup");
      if (text === files.read("config.md")) throw new SettingsError("지역이 이미 같아요", "conflict");
      return { files: new Map([["config.md", text]]), summary: `지역: ${before ?? "(없음)"} → ${p.region}` };
    }
  }
}
