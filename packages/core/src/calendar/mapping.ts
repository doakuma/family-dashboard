// 위키 일정 id <-> 구글 이벤트 id 매핑(결정 0012). 구글 이벤트 id는 위키 id에서 정해지므로(결정적 id) 이 파일은 "무엇을 어떤 내용으로 복사했나"의 기록이다.
// 잃어도 다음 동기화가 전부 다시 올릴 뿐이다(구글 쪽 중복 없음). 단, 위키에서 이미 지운 일정의 구글 복사본은 이 기록 없이는 알 수 없어 남는다.
import { z } from "zod";

export const MAPPING_VERSION = 1;

export const calendarMappingSchema = z.object({
  version: z.literal(MAPPING_VERSION),
  /** 캘린더 id의 지문(해시 앞부분). 원문은 적지 않는다. 캘린더가 바뀌면 기록을 버리고 새로 시작 */
  calendar: z.string().min(1).max(64),
  entries: z.record(
    z.string().regex(/^evt-[A-Za-z0-9]+$/),
    z.object({
      googleId: z.string().regex(/^[a-v0-9]{5,1024}$/),
      /** 구글 id 세대(없으면 0). 지운 같은 id를 되살리지 못할 때 올려서 새 id로 만든다 */
      gen: z.number().int().min(0).max(1000).optional(),
      /** 마지막으로 올린 본문의 해시 */
      hash: z.string().min(1).max(128),
      /** 올린 시각(ISO) */
      at: z.string().max(40),
    }),
  ),
});
export type CalendarMapping = z.infer<typeof calendarMappingSchema>;

export const emptyMapping = (calendar: string): CalendarMapping => ({ version: MAPPING_VERSION, calendar, entries: {} });

/** 읽기 결과: 없으면 mapping 없음, 파일이 깨졌으면 broken(저장소가 옆으로 치워 둔다) */
export interface CalendarMappingRead {
  mapping?: CalendarMapping;
  broken?: boolean;
}

export interface CalendarMappingStore {
  read(): Promise<CalendarMappingRead>;
  write(mapping: CalendarMapping): Promise<void>;
}
