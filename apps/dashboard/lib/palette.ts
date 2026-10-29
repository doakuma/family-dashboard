// 구성원 색 이름(위키에 저장되는 값) → 화면 색. 위키에는 이름만 저장해 테마를 바꿔도 데이터는 그대로다.
export const MEMBER_COLORS = {
  coral: "#E9614F",
  teal: "#14917A",
  blue: "#3A73D6",
  amber: "#D98E0B",
  green: "#4C9A38",
  purple: "#8762CC",
  pink: "#D9558F",
  gray: "#7F8D95",
} as const;

export type MemberColorName = keyof typeof MEMBER_COLORS;

export function colorOf(name?: string): string {
  if (name && name in MEMBER_COLORS) return MEMBER_COLORS[name as MemberColorName];
  if (name && /^#[0-9a-f]{3,8}$/i.test(name)) return name;
  return MEMBER_COLORS.gray;
}
