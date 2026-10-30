// 첫 세팅(SetupInput) -> 위키 파일. 파일 시스템 없이 "읽기 함수 -> 바뀐 파일 목록"만 계산하는 순수 로직(apply.ts와 같은 구조).
import { setupSchema } from "../schema";
import { needsSetup } from "../types";
import type { WikiFiles } from "./apply";
import { formatAnniversaryLine, formatConfigFile, formatMemberFile, parseAnniversaryLine } from "./format";
import { readWiki } from "./read";

export type SetupErrorCode =
  /** 이미 세팅이 끝난 위키 (HTTP 409). MVP는 /settings 전이라 다시 쓰지 않는다 */
  | "already_done"
  /** 세팅 전이지만 지워질 기존 파일이 있다. overwrite를 확인받아야 한다 (HTTP 409) */
  | "needs_confirm"
  /** 입력이 스키마를 통과하지 못했다 (HTTP 422). issues에 필드별 사유 */
  | "invalid"
  /** 읽기 전용 위키 (HTTP 503) */
  | "read_only";

export interface SetupIssue {
  path: string;
  message: string;
}

export class SetupError extends Error {
  constructor(
    message: string,
    readonly code: SetupErrorCode,
    readonly issues: SetupIssue[] = [],
  ) {
    super(message);
  }
}

export interface SetupResult {
  /** 경로 -> 새 내용. null이면 그 파일을 지운다(overwrite로 이전 구성원 파일 정리) */
  files: Map<string, string | null>;
  summary: string;
}

/** 세팅이 끝나기 전에 이미 있는 내용: 덮어쓰기 확인이 필요한지 판단하는 근거 */
export function existingSetupContent(files: WikiFiles) {
  const memberFiles = files.list("members").filter((n) => n.endsWith(".md"));
  const anniversaries = (files.read("anniversaries.md") ?? "").split(/\r?\n/).filter((l) => parseAnniversaryLine(l)).length;
  return { config: files.read("config.md") !== undefined, memberFiles, anniversaries };
}

export function hasExistingSetupContent(files: WikiFiles): boolean {
  const e = existingSetupContent(files);
  return e.config || e.memberFiles.length > 0 || e.anniversaries > 0;
}

/**
 * @param completedAt config.md의 setupCompletedAt에 들어갈 ISO 8601 (시간대 포함)
 */
export function buildSetupFiles(files: WikiFiles, input: unknown, completedAt: string, opts: { overwrite?: boolean } = {}): SetupResult {
  const checked = setupSchema.safeParse(input);
  if (!checked.success) {
    const issues = checked.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new SetupError(`올바르지 않은 세팅 값이에요 (${issues.map((i) => `${i.path || "setup"}: ${i.message}`).join(", ")})`, "invalid", issues);
  }
  const setup = checked.data;

  // 세팅이 끝난 위키에는 쓰지 않는다. 판단은 읽기와 같은 기준(config가 읽히는지 + 구성원 수).
  if (!needsSetup(readWiki(files))) throw new SetupError("이미 세팅이 끝난 위키예요", "already_done");
  if (hasExistingSetupContent(files) && !opts.overwrite) throw new SetupError("세팅 전인데 이전 세팅 파일이 남아 있어요. 덮어쓰기를 확인해 주세요", "needs_confirm");

  const out = new Map<string, string | null>();
  // 이전 구성원 파일 정리(덮어쓰기 확인을 받은 경우만 여기까지 온다). 지우기를 먼저 둬서 대소문자만 다른 파일도 새 파일이 이긴다.
  const keep = new Set(setup.members.map((m) => `members/${m.id}.md`));
  for (const n of files.list("members").filter((n) => n.endsWith(".md"))) if (!keep.has(`members/${n}`)) out.set(`members/${n}`, null);

  out.set("config.md", formatConfigFile({ ...setup.config, setupCompletedAt: completedAt }));
  for (const m of setup.members) out.set(`members/${m.id}.md`, formatMemberFile(m));

  // MM-DD 순(같은 날은 입력 순). 같은 줄이 겹치면 한 번만.
  const lines = setup.anniversaries
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.monthDay < y.a.monthDay ? -1 : x.a.monthDay > y.a.monthDay ? 1 : x.i - y.i))
    .map(({ a }) => formatAnniversaryLine(a));
  const unique = [...new Set(lines)];
  if (unique.length) out.set("anniversaries.md", `${unique.join("\n")}\n`);
  else if (files.read("anniversaries.md") !== undefined) out.set("anniversaries.md", null);

  return { files: out, summary: `가족 세팅: ${setup.config.familyName} (구성원 ${setup.members.length}명, 기념일 ${unique.length}건)` };
}
