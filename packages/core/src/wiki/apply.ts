// Change → 위키 파일 수정. 파일 시스템 없이 "읽기 함수 → 바뀐 파일 목록"만 계산하는 순수 로직.
// 파일 형식을 지키는 책임은 전부 여기에 있다(LLM은 파일을 쓰지 않는다).
import type { Anniversary, Change, Event, Task } from "../types";
import {
  SECTION_TITLE,
  eventFileOf,
  eventSortKey,
  formatAnniversaryLine,
  formatEventLine,
  formatTaskLine,
  parseAnniversaryLine,
  parseEventLine,
  parseCheckId,
  parseTaskLineIn,
} from "./format";

export interface WikiFiles {
  /** 위키 루트 기준 상대 경로. 없으면 undefined */
  read(path: string): string | undefined;
  /** 디렉터리 안의 파일 이름 (예: 'events' → ['2026-11.md']) */
  list(dir: string): string[];
}

export interface ApplyResult {
  /** 경로 → 새 내용 */
  files: Map<string, string>;
  /** 커밋 메시지·log.md에 쓰는 한 줄 요약 */
  summary: string;
  /** 만들어지거나 바뀐 항목 id */
  id?: string;
  /** 반영 후 일정(캘린더 복사용). event.remove면 undefined */
  event?: Event;
}

export class ChangeError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "invalid",
  ) {
    super(message);
  }
}

const TASKS = "tasks.md";
const ANNIV = "anniversaries.md";

export function newId(prefix: "evt" | "task", taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    const id = `${prefix}-${Math.floor(random() * 0x10000).toString(16).padStart(4, "0")}`;
    if (!taken.has(id)) return id;
  }
}

function lines(text: string | undefined): string[] {
  if (!text) return [];
  const ls = text.split(/\r?\n/);
  if (ls.at(-1) === "") ls.pop();
  return ls;
}
const join = (ls: string[]) => `${ls.join("\n")}\n`;

/** 모든 일정 파일의 id 집합과 위치 */
function scanEvents(files: WikiFiles) {
  const where = new Map<string, { path: string; index: number; event: Event }>();
  for (const name of files.list("events").filter((n) => /^\d{4}-\d{2}\.md$/.test(n))) {
    const path = `events/${name}`;
    lines(files.read(path)).forEach((l, index) => {
      const e = parseEventLine(l);
      if (e) where.set(e.id, { path, index, event: e });
    });
  }
  return where;
}

/** 시간순 위치에 일정 줄을 끼워 넣는다. 일정이 아닌 줄(주석 등)은 그대로 둔다. */
function insertEventSorted(ls: string[], e: Event): string[] {
  const key = eventSortKey(e);
  const at = ls.findIndex((l) => {
    const x = parseEventLine(l);
    return x !== null && eventSortKey(x) > key;
  });
  const out = [...ls];
  out.splice(at === -1 ? out.length : at, 0, formatEventLine(e));
  return out;
}

function describeEvent(e: Pick<Event, "date" | "start" | "allDay" | "title">) {
  return `${e.date} ${e.allDay || !e.start ? "종일" : e.start} ${e.title}`;
}

export function applyChange(files: WikiFiles, change: Change, random?: () => number): ApplyResult {
  const out = new Map<string, string>();
  const read = (p: string) => out.get(p) ?? files.read(p);

  switch (change.kind) {
    case "event.add": {
      const events = scanEvents(files);
      const e: Event = { ...change.payload, id: newId("evt", new Set(events.keys()), random), done: false };
      const path = eventFileOf(e.date);
      out.set(path, join(insertEventSorted(lines(read(path)), e)));
      return { files: out, summary: `일정 추가: ${describeEvent(e)}`, id: e.id, event: e };
    }

    case "event.update": {
      const { id, ...patch } = change.payload;
      const found = scanEvents(files).get(id);
      if (!found) throw new ChangeError(`일정 ${id}을(를) 찾을 수 없어요`, "not_found");
      const next: Event = { ...found.event, ...patch, id };
      if (next.allDay) {
        next.start = undefined;
        next.end = undefined;
      }
      const src = lines(read(found.path));
      src.splice(found.index, 1);
      const destPath = eventFileOf(next.date);
      if (destPath === found.path) {
        out.set(found.path, join(insertEventSorted(src, next)));
      } else {
        out.set(found.path, join(src));
        out.set(destPath, join(insertEventSorted(lines(read(destPath)), next)));
      }
      return { files: out, summary: `일정 수정: ${describeEvent(next)}`, id, event: next };
    }

    case "event.remove": {
      const found = scanEvents(files).get(change.payload.id);
      if (!found) throw new ChangeError(`일정 ${change.payload.id}을(를) 찾을 수 없어요`, "not_found");
      const src = lines(read(found.path));
      src.splice(found.index, 1);
      out.set(found.path, join(src));
      return { files: out, summary: `일정 삭제: ${describeEvent(found.event)}`, id: found.event.id };
    }

    case "task.add": {
      const src = lines(read(TASKS));
      const taken = new Set(src.flatMap((l) => parseCheckId(l) ?? []));
      const t: Task = { ...change.payload, id: newId("task", taken, random), done: false };
      const title = `## ${SECTION_TITLE[t.list]}`;
      let h = src.findIndex((l) => l.trim() === title);
      if (h === -1) {
        if (src.length && src.at(-1) !== "") src.push("");
        src.push(title);
        h = src.length - 1;
      }
      // 섹션의 마지막 항목 바로 뒤(다음 ## 또는 빈 줄들 앞)에 넣는다.
      let at = h + 1;
      for (let i = h + 1; i < src.length && !src[i]?.startsWith("## "); i++) {
        if ((src[i] ?? "").trim() !== "") at = i + 1;
      }
      src.splice(at, 0, formatTaskLine(t));
      out.set(TASKS, join(src));
      return { files: out, summary: `${SECTION_TITLE[t.list]} 추가: ${t.title}`, id: t.id };
    }

    case "task.done": {
      const src = lines(read(TASKS));
      const i = src.findIndex((l) => parseCheckId(l) === change.payload.id);
      const t = i === -1 ? null : parseTaskLineIn(src, i);
      if (!t) throw new ChangeError(`할 일 ${change.payload.id}을(를) 찾을 수 없어요`, "not_found");
      src[i] = formatTaskLine({ ...t, done: true });
      out.set(TASKS, join(src));
      return { files: out, summary: `완료: ${t.title}`, id: t.id };
    }

    case "anniversary.add": {
      const a: Anniversary = change.payload;
      const src = lines(read(ANNIV));
      const at = src.findIndex((l) => {
        const x = parseAnniversaryLine(l);
        return x !== null && x.monthDay > a.monthDay;
      });
      src.splice(at === -1 ? src.length : at, 0, formatAnniversaryLine(a));
      out.set(ANNIV, join(src));
      return { files: out, summary: `기념일 추가: ${a.monthDay} ${a.title}` };
    }

    default: {
      const never: never = change;
      throw new ChangeError(`알 수 없는 변경: ${JSON.stringify(never)}`, "invalid");
    }
  }
}

/** log.md 한 줄 */
export function formatLogLine(at: string, kind: string, summary: string, by: string, id?: string): string {
  return `- ${at} [${kind}] ${summary} (by ${by})${id ? ` #${id}` : ""}`;
}
