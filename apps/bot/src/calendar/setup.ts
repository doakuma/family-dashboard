// 구글 캘린더 동기화 연결(결정 0012): 설정이 없으면 꺼짐(아무 것도 안 함). 있으면 CalendarReconciler를 만들고
// 시작 직후 한 번 + 주기적으로 돌린다. 슬랙에서 일정을 쓴 직후에는 hook.ts가 kick()으로 깨운다.
import { CALENDAR_ID_RE, CalendarReconciler, type CalendarRuntime, type ConfigProvider, type FamilyId, type WikiFiles, type WikiRepository } from "@hsh/core";
import { FsCalendarMappingStore, GoogleCalendarSync, googleEventId, loadServiceAccountKey, sha256Hex, type GoogleFetch } from "@hsh/core/node";

export const CALENDAR_INTERVAL_MS = 5 * 60_000;
export const CALENDAR_START_DELAY_MS = 15_000;

export interface CalendarSyncHandle {
  /** 한 바퀴를 깨운다(이미 돌고 있으면 합쳐짐). 던지지 않고 기다리지 않는다 */
  kick(): void;
  stop(): void;
  reconciler: CalendarReconciler;
}

export interface StartCalendarSyncDeps {
  config: ConfigProvider;
  wiki: Pick<WikiRepository, "read">;
  /** 위키 파일 읽기(events 원문에 일정 id가 남아 있는지 보려고). 없으면 그 검사를 하지 않는다 */
  files?: WikiFiles;
  familyId: FamilyId;
  fetch?: GoogleFetch;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  intervalMs?: number;
  startDelayMs?: number;
  now?: () => Date;
  /** 구글 재시도 대기(시험에서 빠르게) */
  sleep?: (ms: number) => Promise<void>;
}

export async function startCalendarSync(deps: StartCalendarSyncDeps): Promise<CalendarSyncHandle | undefined> {
  const log = deps.log ?? ((m) => console.log(`[calendar] ${m}`));
  const warn = deps.warn ?? ((m) => console.warn(`[calendar] ${m}`));
  const cfg = deps.config.get("googleCalendar");
  if (!cfg.serviceAccountPath) {
    log("구글 캘린더 복사는 꺼져 있어요(GOOGLE_SERVICE_ACCOUNT_JSON 없음)");
    return undefined;
  }
  let key;
  try {
    key = await loadServiceAccountKey(cfg.serviceAccountPath);
  } catch (e) {
    // 메시지는 고정 문구(+키 파일 경로)뿐이다. 봇의 나머지는 계속 돈다
    warn(`${e instanceof Error ? e.message : "서비스 계정 파일을 읽지 못했어요"}. 구글 캘린더 복사를 켜지 않았어요`);
    return undefined;
  }
  let fallback = cfg.calendarId;
  if (fallback && !CALENDAR_ID_RE.test(fallback)) {
    warn("GOOGLE_CALENDAR_ID가 캘린더 id(메일 주소) 모양이 아니라 무시해요");
    fallback = undefined;
  }

  const runtime: CalendarRuntime = { context: { timezone: "Asia/Seoul", names: {} } };
  const reconciler = new CalendarReconciler({
    familyId: deps.familyId,
    readState: (id) => deps.wiki.read(id),
    sync: new GoogleCalendarSync({ key, familyId: deps.familyId, runtime, sleep: deps.sleep, fetch: deps.fetch ?? ((url, init) => fetch(url, init)) }),
    store: new FsCalendarMappingStore({ dir: deps.config.get("stateDir"), familyId: deps.familyId }),
    runtime,
    fallbackCalendarId: fallback,
    mentionsEventId: deps.files ? eventIdMentioned(deps.files) : undefined,
    hash: sha256Hex,
    googleId: googleEventId,
    now: deps.now,
    log,
    warn,
  });

  const kick = () => void reconciler.run();
  const first = setTimeout(kick, deps.startDelayMs ?? CALENDAR_START_DELAY_MS);
  const timer = setInterval(kick, deps.intervalMs ?? CALENDAR_INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
  log("구글 캘린더 복사를 켰어요(위키 -> 구글 단방향)");
  return {
    kick,
    reconciler,
    stop: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

/** events/*.md 원문에 `#evt-…` 토큰이 아직 있는지(형식이 깨져 읽히지 않는 줄도 찾는다) */
export function eventIdMentioned(files: WikiFiles): (wikiId: string) => boolean {
  return (id) => {
    const re = new RegExp(`#${id}(?![A-Za-z0-9])`);
    return files.list("events").some((n) => /^\d{4}-\d{2}\.md$/.test(n) && re.test(files.read(`events/${n}`) ?? ""));
  };
}
