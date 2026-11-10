// 대화 흐름이 부르는 위키 저장소에 "일정이 바뀌면 캘린더 동기화를 깨운다"를 덧붙인다(결정 0012).
// 위키 쓰기가 성공한 뒤에만 깨우고, 깨우는 일은 기다리지도 실패를 전하지도 않는다(캘린더 실패는 위키 쓰기·대화 흐름을 실패시키지 않는다).
import type { WikiRepository } from "@hsh/core";

export function withCalendarKick(wiki: WikiRepository, kick: () => void, warn: (m: string) => void = (m) => console.warn(`[calendar] ${m}`)): WikiRepository {
  return {
    read: (id) => wiki.read(id),
    applySetup: (id, setup, opts) => wiki.applySetup(id, setup, opts),
    applySettings: (id, change, opts) => wiki.applySettings(id, change, opts),
    async apply(id, change) {
      const result = await wiki.apply(id, change);
      if (change.kind.startsWith("event.")) {
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
