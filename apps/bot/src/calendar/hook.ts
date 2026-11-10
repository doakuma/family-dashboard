// 대화 흐름이 부르는 위키 저장소에 "일정이 바뀌면 캘린더 동기화를 깨운다"를 덧붙인다(결정 0012).
// 위키 쓰기가 성공한 뒤에만 깨우고, 깨우는 일은 기다리지도 실패를 전하지도 않는다(캘린더 실패는 위키 쓰기·대화 흐름을 실패시키지 않는다).
import type { Change, WikiRepository } from "@hsh/core";

/** 캘린더에 복사되는 변경(일정). 할 일·기념일은 복사 대상이 아니다. Change에 일정 종류가 늘면 여기에 넣는다(시험이 전체 종류를 확인) */
export const CALENDAR_CHANGE_KINDS: readonly Change["kind"][] = ["event.add", "event.update", "event.remove"];

export function withCalendarKick(wiki: WikiRepository, kick: () => void, warn: (m: string) => void = (m) => console.warn(`[calendar] ${m}`)): WikiRepository {
  return {
    read: (id) => wiki.read(id),
    applySetup: (id, setup, opts) => wiki.applySetup(id, setup, opts),
    applySettings: (id, change, opts) => wiki.applySettings(id, change, opts),
    async apply(id, change) {
      const result = await wiki.apply(id, change);
      if (CALENDAR_CHANGE_KINDS.includes(change.kind)) {
        try {
          kick();
        } catch {
          warn("캘린더 동기화를 깨우지 못했어요. 주기 동기화 때 따라가요");
        }
      }
      return result;
    },
  };
}
