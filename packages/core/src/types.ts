// 공통 도메인 타입 — MVP 스펙 "인터페이스" 절을 그대로 옮긴다.
// 스펙이 바뀌면 스펙 문서를 먼저 고치고 이 파일을 맞춘다.

/** 구성원 id. 'family'는 가족 전체를 뜻하는 예약 id. */
export type MemberId = string;
export const FAMILY_ID: MemberId = "family";

export type MemberRole = "guardian" | "child";

export interface Member {
  id: MemberId;
  name: string;
  /** guardian = 쓰기 가능, child = 질문만 */
  role: MemberRole;
  /** YYYY-MM-DD */
  birth?: string;
  color: string;
  slackId?: string;
}

/** config.md — 가족 세팅 결과 */
export interface FamilyConfig {
  familyName: string;
  timezone: string;
  region?: string;
  kmaNx?: number;
  kmaNy?: number;
  kmaMidLandRegId?: string;
  kmaMidTaRegId?: string;
  familyColor: string;
  calendarId?: string;
  /** ISO 8601. 있으면 세팅 완료 */
  setupCompletedAt?: string;
}

/** 일정 공유 그룹 id (예: 'cousins'). 소문자·숫자·`_`·`-`. MVP는 필드만 있고 공유 동작·그룹 정의는 없다. */
export type ShareGroupId = string;

export interface Event {
  /** evt-xxxx */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  start?: string;
  /** HH:MM */
  end?: string;
  allDay: boolean;
  title: string;
  members: MemberId[];
  /** 위키 줄의 `&그룹id` 토큰. 없으면 우리 가족만. LLM이 만들거나 바꾸지 못한다(Change에 없음). */
  share?: ShareGroupId;
  done: boolean;
}

export type TaskList = "shopping" | "todo";

export interface Task {
  /** task-xxxx */
  id: string;
  list: TaskList;
  title: string;
  member?: MemberId;
  done: boolean;
}

export interface Anniversary {
  /** MM-DD */
  monthDay: string;
  title: string;
  member?: MemberId;
}

export type WeatherIcon = "sunny" | "partly" | "cloudy" | "rain" | "snow" | "shower";

export interface WeatherDay {
  /** YYYY-MM-DD */
  date: string;
  icon: WeatherIcon;
  max: number;
  min: number;
  /** 강수확률 % */
  pop?: number;
}

export interface DashboardState {
  config?: FamilyConfig;
  members: Member[];
  events: Event[];
  tasks: Task[];
  anniversaries: Anniversary[];
  weather: WeatherDay[];
  /** ISO 8601 */
  updatedAt: string;
}

export type WikiState = Omit<DashboardState, "weather" | "updatedAt"> & {
  /** 읽다가 값이 틀려 기본값으로 대체하거나 파일을 건너뛴 일. 화면에는 내지 않고 서버 로그에 남긴다. */
  warnings: string[];
};

/** LLM이 메시지에서 만들어 내는 변경. 파일 쓰기는 WikiRepository.apply가 결정적으로 처리한다. */
export type Change =
  | { kind: "event.add"; payload: Omit<Event, "id" | "done" | "share"> }
  | { kind: "event.update"; payload: { id: string } & Partial<Omit<Event, "id" | "share">> }
  | { kind: "event.remove"; payload: { id: string } }
  | { kind: "task.add"; payload: Omit<Task, "id" | "done"> }
  | { kind: "task.done"; payload: { id: string } }
  | { kind: "anniversary.add"; payload: Anniversary };

export type ChangeKind = Change["kind"];

export interface IncomingMessage {
  /** 메신저 종류 (1차: 'slack') */
  source: string;
  userId: string;
  channelId: string;
  /** 답장을 달 스레드 */
  threadId: string;
  text: string;
}

/** 가족 세팅이 필요한지: config.md가 없거나 구성원이 없으면 true */
export function needsSetup(state: Pick<WikiState, "config" | "members">): boolean {
  return !state.config || state.members.length === 0;
}
