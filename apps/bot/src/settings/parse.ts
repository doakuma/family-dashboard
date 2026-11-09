// 슬랙 색 변경 고정 명령의 문장 모양 인식(순수 함수, LLM 없음). "하늘이 색 초록으로 바꿔줘" / "하늘 색 초록".
// 보수적으로 인식한다: 모양이 정확히 맞을 때만 명령으로 보고, 아니면 undefined(기존 대화 흐름으로 넘긴다).
// 이름·색이 실제로 있는지는 여기서 보지 않는다(위키가 필요하므로 handler가 한다).
import { parseColorName, type PickableColor } from "@hsh/core";

export interface ColorCommand {
  /** 문장에서 "색" 앞에 있던 말(이름·id·@멤버 멘션, 조사 포함) */
  target: string;
  /** 말한 색 낱말(조사 '으로/로' 제외) */
  colorWord: string;
  /** 고를 수 있는 색이면 그 색 이름, 모르는 색이면 undefined */
  color?: PickableColor;
  /** "~로 바꿔줘" 꼴인가. 짧은 꼴("하늘 색 초록")은 아는 색일 때만 명령으로 본다 */
  explicit: boolean;
}

const END = String.raw`[\s.!?~]*$`;
// A: <대상> (이|가|의)? 색(깔)? (을|를)? <색>(으)?로 (좀)? 바꿔(줘|주세요|줄래|봐)?
const LONG = new RegExp(String.raw`^(.{1,60}?)\s*색(?:깔)?\s*(?:을|를)?\s+(\S{1,20}?)\s*(?:으)?로\s*(?:좀\s*)?바꿔(?:\s*(?:줘|줘요|주세요|줄래|줄래요|봐|라))?${END}`);
// 붙여 쓴 "초록으로"가 아니라 "색을초록으로"처럼 공백이 없는 경우도 받는다
const LONG_TIGHT = new RegExp(String.raw`^(.{1,60}?)\s*색(?:깔)?(?:을|를)(\S{1,20}?)\s*(?:으)?로\s*(?:좀\s*)?바꿔(?:\s*(?:줘|줘요|주세요|줄래|줄래요|봐|라))?${END}`);
// B: <대상> 색(깔) <색>   (끝이 색 낱말 하나일 때만)
const SHORT = new RegExp(String.raw`^(.{1,60}?)\s+색(?:깔)?\s*[:：]?\s*(\S{1,20})${END}`);

const clean = (s: string) => s.trim().replace(/[\s.!?~]+$/, "");

export function parseColorCommand(raw: string): ColorCommand | undefined {
  const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text || text.length > 120) return undefined;
  const long = LONG.exec(text) ?? LONG_TIGHT.exec(text);
  if (long?.[1] && long[2]) return { target: clean(long[1]), colorWord: long[2], color: parseColorName(long[2]), explicit: true };
  const short = SHORT.exec(text);
  if (short?.[1] && short[2]) {
    const colorWord = clean(short[2]);
    const color = parseColorName(colorWord);
    // 짧은 꼴은 오탐이 쉬우니(예: "하늘이 색 종이") 아는 색일 때만
    if (color) return { target: clean(short[1]), colorWord, color, explicit: false };
  }
  return undefined;
}
