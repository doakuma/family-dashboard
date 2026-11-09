// /settings 화면이 보는 위키 상태. 허용 목록으로 골라 담는다: 슬랙 ID·생일·calendarId는 내보내지 않고 연결됨 여부(boolean)만 준다.
import { ALL_REGIONS, SETUP_MAX_MEMBERS, type MemberRole, type WikiState } from "@hsh/core";

export interface SettingsMemberView {
  id: string;
  name: string;
  role: MemberRole;
  /** 위키의 색 이름(목록 밖 값이면 그대로) */
  color: string;
  /** 슬랙에 연결됐는가 */
  connected: boolean;
}

export interface SettingsView {
  familyName: string;
  /** config.md의 지역 이름 */
  region?: string;
  /** 지역표에 있는 지역이면 그 키(선택 상자의 현재 값) */
  regionKey?: string;
  members: SettingsMemberView[];
  maxMembers: number;
}

export function toSettingsView(state: Pick<WikiState, "config" | "members">): SettingsView {
  const region = state.config?.region;
  return {
    familyName: state.config?.familyName ?? "",
    ...(region ? { region } : {}),
    ...(region ? { regionKey: ALL_REGIONS.find((r) => r.label === region)?.key } : {}),
    members: state.members.filter((m) => m.id !== "family").map((m) => ({ id: m.id, name: m.name, role: m.role, color: m.color, connected: Boolean(m.slackId) })),
    maxMembers: SETUP_MAX_MEMBERS,
  };
}
