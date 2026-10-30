// 스킨 계약: 스킨이 반드시 정의하는 토큰. 위젯은 이 이름만 참조한다(스킨 테스트가 검사).
// 위키에는 구성원 색 이름만 저장하고, 실제 색값은 스킨의 색 슬롯 8개(--member-<name>)가 정한다.

export const MEMBER_COLOR_SLOTS = ["coral", "teal", "blue", "amber", "green", "purple", "pink", "gray"] as const;
export type MemberColorSlot = (typeof MEMBER_COLOR_SLOTS)[number];

/** 낮·어두운 톤마다 값이 달라야 하는 색 토큰 (어두운 톤 블록이 모두 다시 정의한다) */
export const COLOR_TOKENS = [
  "paper",
  "sheet",
  "ink",
  "muted",
  "faint",
  "line",
  "text-sunday",
  "text-saturday",
  "text-precip",
  "warn",
  ...MEMBER_COLOR_SLOTS.map((n) => `member-${n}`),
  "icon-sun",
  "icon-cloud",
  "icon-drop",
] as const;

/** 낮 블록에만 정의하면 되는 모양 토큰 (글꼴·모서리·그림자·간격·배경 장식) */
export const SHAPE_TOKENS = [
  "font-display",
  "font-body",
  "radius-xs",
  "radius-sm",
  "radius-md",
  "radius-lg",
  "shadow-card",
  "gap",
  "pad",
  "deco-bg",
] as const;

/** 스킨이 정의할 수 없는 공통 토큰(globals.css). 글자 크기 하한은 스킨이 낮출 수 없다. */
export const COMMON_TOKENS = ["text-floor"] as const;

export interface SkinManifest {
  id: string;
  name: string;
  description?: string;
  /** 임시 검증용 스킨 표시 */
  temporary?: boolean;
}
