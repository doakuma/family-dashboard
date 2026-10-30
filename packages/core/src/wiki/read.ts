import type { FamilyId, WikiState } from "../types";
import type { WikiFiles } from "./apply";
import {
  eventSortKey,
  familyMember,
  parseAnniversariesFile,
  parseConfigFile,
  parseEventsFile,
  parseMemberFile,
  parseTasksFile,
} from "./format";

/** 위키 파일 전체를 도메인 상태로 읽는다. 형식이 깨진 줄은 건너뛴다(화면이 죽지 않게). */
export function readWiki(files: WikiFiles, familyId: FamilyId): WikiState {
  // 필드 하나가 틀리면 그 필드만 기본값으로 읽고 경고를 모은다(필수값이 깨진 파일만 건너뜀). 쓰기 스키마는 엄격 그대로.
  const warnings: string[] = [];
  const warnAt = (file: string) => (m: string) => warnings.push(`${file}: ${m}`);

  const configText = files.read("config.md");
  const config = configText ? (parseConfigFile(configText, warnAt("config.md")) ?? undefined) : undefined;

  const people = files
    .list("members")
    .filter((n) => n.endsWith(".md"))
    .flatMap((n) => parseMemberFile(files.read(`members/${n}`) ?? "", warnAt(`members/${n}`)) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const events = files
    .list("events")
    .filter((n) => /^\d{4}-\d{2}\.md$/.test(n))
    .flatMap((n) => parseEventsFile(files.read(`events/${n}`) ?? "", warnAt(`events/${n}`)))
    .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));

  return {
    familyId,
    config,
    // 실제 구성원이 있을 때만 '가족 전체'를 붙인다 → 구성원 0명이면 세팅 화면.
    members: people.length ? [...people, familyMember(config)] : [],
    events,
    tasks: parseTasksFile(files.read("tasks.md") ?? ""),
    anniversaries: parseAnniversariesFile(files.read("anniversaries.md") ?? ""),
    warnings,
  };
}
