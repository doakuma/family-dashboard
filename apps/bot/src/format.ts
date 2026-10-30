// 슬랙 문구용 날짜 표기. 의도 확인 미리보기와 질문 응답이 같이 쓴다.
import { weekdayKo } from "@hsh/core";

/** "11/3(화)" */
export function formatDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}(${weekdayKo(date)})`;
}

/** "11/3(화) 15:00" 또는 "11/3(화) 종일" */
export function formatWhen(date: string, start?: string, allDay?: boolean): string {
  return `${formatDay(date)}${allDay || !start ? " 종일" : ` ${start}`}`;
}
