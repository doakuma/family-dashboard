// draft -> 서버로 보내는 SetupInput, 서버 오류 경로 -> 화면 필드, 6단계 미리보기 상태.
import {
  DEFAULT_FAMILY_ID,
  familyMember,
  findRegion,
  regionToConfigFields,
  toPublicState,
  type Anniversary,
  type ApiState,
  type DashboardState,
  type Member,
  type SetupInput,
  type SetupIssue,
  type WeatherDay,
} from "@hsh/core";
import type { Draft, MemberDraft } from "./draft";
import { validMonthDay, type Errors } from "./validate";

const pad2 = (s: string) => s.trim().padStart(2, "0");

/** 생일이 있는 구성원마다 "이름 생일" 기념일. 제목에 '생일'이 있어야 대시보드가 나이를 보여 준다. */
export function birthdayAnniversaries(members: readonly MemberDraft[]): Anniversary[] {
  return members.flatMap((m) =>
    /^\d{4}-\d{2}-\d{2}$/.test(m.birth) && m.name.trim() ? [{ monthDay: m.birth.slice(5), title: `${m.name.trim()} 생일`, member: m.id.trim() }] : [],
  );
}

export function extraAnniversaries(d: Draft): Anniversary[] {
  return d.anniversaries.flatMap((a) => (validMonthDay(a.month, a.day) ? [{ monthDay: `${pad2(a.month)}-${pad2(a.day)}`, title: a.title.trim(), member: a.member }] : []));
}

export function toMembers(d: Draft): Member[] {
  return d.members.map((m) => ({
    id: m.id.trim(),
    name: m.name.trim(),
    role: m.role,
    ...(m.birth ? { birth: m.birth } : {}),
    color: m.color,
  }));
}

export function toSetupInput(d: Draft): SetupInput {
  const region =
    d.regionMode === "list"
      ? (() => {
          const r = findRegion(d.regionKey);
          return r ? regionToConfigFields(r) : {};
        })()
      : {
          region: d.manual.label.trim(),
          kmaNx: Number(d.manual.nx.trim()),
          kmaNy: Number(d.manual.ny.trim()),
          kmaMidLandRegId: d.manual.landId.trim(),
          kmaMidTaRegId: d.manual.taId.trim(),
        };
  return {
    config: {
      familyName: d.familyName.trim(),
      timezone: d.timezone.trim(),
      familyColor: "gray",
      ...region,
      ...(d.calendarId.trim() ? { calendarId: d.calendarId.trim() } : {}),
    },
    members: toMembers(d),
    anniversaries: [...birthdayAnniversaries(d.members), ...extraAnniversaries(d)],
  };
}

/** 서버(setupSchema)가 돌려준 경로 -> 화면 필드 키. 매핑할 수 없는 오류는 form으로 모은다. */
export function serverIssuesToErrors(d: Draft, issues: readonly SetupIssue[]): Errors {
  const errors: Errors = {};
  const birthdayCount = birthdayAnniversaries(d.members).length;
  const birthdayOwners = d.members.filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.birth) && m.name.trim());
  const extras = d.anniversaries.filter((a) => validMonthDay(a.month, a.day));
  const put = (field: string, message: string) => {
    errors[field] ??= message;
  };
  for (const { path, message } of issues) {
    const p = path.split(".");
    const manual = d.regionMode === "manual";
    if (p[0] === "config") {
      const map: Record<string, string> = {
        familyName: "familyName",
        timezone: "timezone",
        calendarId: "calendarId",
        region: manual ? "manual.label" : "region",
        kmaNx: manual ? "manual.nx" : "region",
        kmaNy: manual ? "manual.ny" : "region",
        kmaMidLandRegId: manual ? "manual.landId" : "region",
        kmaMidTaRegId: manual ? "manual.taId" : "region",
      };
      put(map[p[1] ?? ""] ?? "form", message);
    } else if (p[0] === "members" && p[1] !== undefined) {
      const m = d.members[Number(p[1])];
      const f = p[2];
      if (m && (f === "name" || f === "birth" || f === "color" || f === "id")) put(`member.${m.key}.${f}`, message);
      else put("members", message);
    } else if (p[0] === "members") {
      put("members", message);
    } else if (p[0] === "anniversaries" && p[1] !== undefined) {
      const i = Number(p[1]);
      if (i < birthdayCount) {
        const owner = birthdayOwners[i];
        put(owner ? `member.${owner.key}.birth` : "form", message);
      } else {
        const a = extras[i - birthdayCount];
        const f = p[2] === "monthDay" ? "date" : p[2];
        put(a && (f === "date" || f === "title" || f === "member") ? `anniv.${a.key}.${f}` : "form", message);
      }
    } else {
      put("form", message);
    }
  }
  return errors;
}

/** 6단계 미리보기: 입력값으로 만든 /api/state 모양. 일정·할 일은 비어 있고 날씨는 호출자가 예시를 넣는다. */
export function toPreviewState(d: Draft, now: Date, weather: WeatherDay[] = []): ApiState {
  const input = toSetupInput(d);
  const config: DashboardState["config"] = { ...input.config, setupCompletedAt: now.toISOString() };
  const state: DashboardState = {
    familyId: DEFAULT_FAMILY_ID, // 미리보기용 - 공개 상태에는 어차피 안 나간다
    config,
    members: [...input.members, familyMember(config)],
    events: [],
    tasks: [],
    anniversaries: input.anniversaries,
    weather,
    updatedAt: now.toISOString(),
  };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: input.config.timezone || "Asia/Seoul" }).format(now);
  return toPublicState(state, today);
}
