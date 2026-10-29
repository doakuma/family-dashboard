import type { WikiState } from "../types";
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
export function readWiki(files: WikiFiles): WikiState {
  const configText = files.read("config.md");
  const config = configText ? (parseConfigFile(configText) ?? undefined) : undefined;

  const people = files
    .list("members")
    .filter((n) => n.endsWith(".md"))
    .flatMap((n) => parseMemberFile(files.read(`members/${n}`) ?? "") ?? [])
    .filter((m) => m.id !== "family")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const events = files
    .list("events")
    .filter((n) => /^\d{4}-\d{2}\.md$/.test(n))
    .flatMap((n) => parseEventsFile(files.read(`events/${n}`) ?? ""))
    .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));

  return {
    config,
    // 실제 구성원이 있을 때만 '가족 전체'를 붙인다 → 구성원 0명이면 세팅 화면.
    members: people.length ? [...people, familyMember(config)] : [],
    events,
    tasks: parseTasksFile(files.read("tasks.md") ?? ""),
    anniversaries: parseAnniversariesFile(files.read("anniversaries.md") ?? ""),
  };
}
