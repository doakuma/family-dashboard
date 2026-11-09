import { describe, expect, it } from "vitest";
import { toSettingsView } from "./view";

describe("toSettingsView", () => {
  const state = {
    config: { familyName: "햇살네", timezone: "Asia/Seoul", familyColor: "gray", region: "서울특별시 마포구", calendarId: "me@gmail.com" },
    members: [
      { id: "mom", name: "엄마", role: "guardian" as const, color: "coral", slackId: "U0MOM", birth: "1988-03-12" },
      { id: "haneul", name: "하늘", role: "child" as const, color: "blue" },
      { id: "family", name: "가족", role: "guardian" as const, color: "gray" },
    ],
  };
  it("연결됨 여부만 싣고, 슬랙 ID·생일·calendarId는 없다", () => {
    const v = toSettingsView(state);
    expect(v.members).toEqual([
      { id: "mom", name: "엄마", role: "guardian", color: "coral", connected: true },
      { id: "haneul", name: "하늘", role: "child", color: "blue", connected: false },
    ]);
    const text = JSON.stringify(v);
    for (const secret of ["U0MOM", "1988", "me@gmail.com"]) expect(text).not.toContain(secret);
    expect(v).toMatchObject({ familyName: "햇살네", region: "서울특별시 마포구", regionKey: "seoul-mapo", maxMembers: 12 });
  });
  it("지역표에 없는 지역은 regionKey 없음", () => {
    expect(toSettingsView({ ...state, config: { ...state.config, region: "달나라" } }).regionKey).toBeUndefined();
  });
});
