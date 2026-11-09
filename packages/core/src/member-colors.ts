// 구성원 색 이름(위키에 저장되는 값)과 한국어·영문 표기. 대시보드 색 고르기 화면과 슬랙 색 변경 명령이 같은 표를 쓴다.
// 실제 색값은 스킨의 색 슬롯(--member-<name>)이 정하므로 여기에는 이름만 있다.

/** 자동 추천 순서. gray는 '가족 전체' 색이라 구성원 후보에서 뺀다. */
export const PICKABLE_COLORS = ["coral", "teal", "blue", "amber", "green", "purple", "pink"] as const;
export type PickableColor = (typeof PICKABLE_COLORS)[number];

export const COLOR_LABELS: Record<PickableColor, string> = {
  coral: "산호",
  teal: "청록",
  blue: "파랑",
  amber: "호박",
  green: "초록",
  purple: "보라",
  pink: "분홍",
};

export const isPickableColor = (c: string): c is PickableColor => (PICKABLE_COLORS as readonly string[]).includes(c);

/** 사람이 읽는 색 이름. 목록에 없는 값(gray, #hex 등)은 있는 그대로 */
export const colorLabel = (c: string): string => (isPickableColor(c) ? COLOR_LABELS[c] : c);

/** 말로 하는 색 별칭(화면 견본 이름과 다르게 흔히 쓰는 말). 구성원 이름과 헷갈릴 말(하늘 등)은 넣지 않는다 */
const COLOR_ALIASES: Record<string, PickableColor> = {
  노랑: "amber",
  노란: "amber",
  녹색: "green",
  파란: "blue",
};

/** 색 이름·한국어 표기·영문 이름(대소문자 무시) -> 색 이름. 모르면 undefined */
export function parseColorName(raw: string): PickableColor | undefined {
  const t = raw.trim();
  // "녹색"처럼 '색'으로 끝나는 별칭이 있어 접미를 뗀 것과 안 뗀 것을 모두 본다
  for (const w of [t, t.replace(/색$/, "").trim()]) {
    if (!w) continue;
    const lower = w.toLowerCase();
    if (isPickableColor(lower)) return lower;
    for (const c of PICKABLE_COLORS) if (COLOR_LABELS[c] === w) return c;
    if (COLOR_ALIASES[w]) return COLOR_ALIASES[w];
  }
  return undefined;
}

/** 사용자에게 보여 줄 색 목록 문구 */
export const COLOR_LIST_TEXT = PICKABLE_COLORS.map((c) => COLOR_LABELS[c]).join(" · ");
