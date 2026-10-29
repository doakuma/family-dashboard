// 공통 도메인 타입 — MVP 스펙 "인터페이스" 절을 그대로 옮긴다.
// 스펙이 바뀌면 스펙 문서를 먼저 고치고 이 파일을 맞춘다.

/** 구성원 id. 'family'는 가족 전체를 뜻하는 예약 id. */
export type MemberId = string;
export const FAMILY_ID: MemberId = "family";

export interface Member {
  id: MemberId;
  name: string;
  /** YYYY-MM-DD */
  birth?: string;
  color: string;
  slackId?: string;
}

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
  done: boolean;
}

export interface Task {
  /** task-xxxx */
  id: string;
  list: "shopping" | "todo";
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

export interface WeatherDay {
  /** YYYY-MM-DD */
  date: string;
  /** 아이콘 키 (예: 'sunny' | 'cloudy' | 'rain' | 'snow') */
  icon: string;
  max: number;
  min: number;
}

export interface DashboardState {
  members: Member[];
  events: Event[];
  tasks: Task[];
  anniversaries: Anniversary[];
  weather: WeatherDay[];
  /** ISO 8601 */
  updatedAt: string;
}

export type WikiState = Omit<DashboardState, "weather" | "updatedAt">;

/** LLM이 메시지에서 만들어 내는 변경. 파일 쓰기는 WikiRepository.apply가 결정적으로 처리한다. */
export type Change =
  | { kind: "event.add"; payload: Omit<Event, "id" | "done"> }
  | { kind: "event.update"; payload: { id: string } & Partial<Omit<Event, "id">> }
  | { kind: "event.remove"; payload: { id: string } }
  | { kind: "task.add"; payload: Omit<Task, "id" | "done"> }
  | { kind: "task.done"; payload: { id: string } }
  | { kind: "anniversary.add"; payload: Anniversary };

export interface IncomingMessage {
  /** 메신저 종류 (1차: 'slack') */
  source: string;
  userId: string;
  channelId: string;
  /** 답장을 달 스레드 */
  threadId: string;
  text: string;
}
