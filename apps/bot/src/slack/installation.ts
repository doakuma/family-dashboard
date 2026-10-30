// 슬랙 설치 정보(봇 토큰) 조회. 봇은 토큰을 env에서 직접 읽지 않고 InstallationStore.fetchInstallation()으로 받는다(결정 0003).
// 모양은 Bolt/@slack/oauth의 InstallationStore와 호환된다. MVP 구현은 설정(ConfigProvider)의 토큰 하나를 돌려주고,
// 서비스에서는 워크스페이스별 OAuth 설치를 저장·조회하는 구현으로 바꾼다. Socket Mode는 그대로 쓴다.
import type { ConfigProvider } from "@hsh/core";
import type { Authorize, Installation, InstallationQuery, InstallationStore } from "@slack/bolt";

/** MVP: 토큰이 하나뿐이라 query(워크스페이스)와 무관하게 같은 설치를 돌려준다. 설치 저장·삭제는 하지 않는다(토큰은 .env가 원본). */
export class EnvInstallationStore implements InstallationStore {
  constructor(private readonly config: ConfigProvider) {}

  async storeInstallation(): Promise<void> {
    throw new Error("EnvInstallationStore는 설치를 저장하지 않아요(토큰은 .env). OAuth 설치는 서비스 전환 때 다른 구현으로 바꿔요");
  }

  async fetchInstallation(query: InstallationQuery<boolean>): Promise<Installation<"v2", boolean>> {
    const token = this.config.get("slack").botToken;
    if (!token) throw new Error("SLACK_BOT_TOKEN이 필요합니다. .env.example을 참고하세요.");
    return {
      team: query.teamId ? { id: query.teamId } : undefined,
      enterprise: query.enterpriseId ? { id: query.enterpriseId } : undefined,
      user: { id: "", token: undefined, scopes: undefined },
      bot: { token, scopes: [], id: "", userId: "" },
      isEnterpriseInstall: query.isEnterpriseInstall,
      tokenType: "bot",
      authVersion: "v2",
    };
  }
}

/**
 * Bolt의 authorize 훅을 설치 저장소 위에 만든다. (Bolt가 저장소를 직접 쓰게 하려면 OAuth 설치 설정이 필요해서,
 * Socket Mode + 저장소만 쓰는 지금은 authorize로 잇는다.) 봇 id는 auth.test로 한 번 채우고 토큰별로 캐시한다.
 */
export function authorizeWith(
  store: InstallationStore,
  whoami: (token: string) => Promise<{ botId?: string; botUserId?: string }>,
): Authorize<boolean> {
  const cache = new Map<string, { botId: string; botUserId: string }>();
  return async (source) => {
    const inst = await store.fetchInstallation({ teamId: source.teamId, enterpriseId: source.enterpriseId, isEnterpriseInstall: source.isEnterpriseInstall });
    const token = inst.bot?.token;
    if (!token) throw new Error("이 워크스페이스의 봇 설치 정보가 없어요");
    let who = cache.get(token);
    if (!who) {
      const botId = inst.bot?.id || undefined;
      const botUserId = inst.bot?.userId || undefined;
      // 두 값이 다 있을 때만 캐시한다(부분값을 캐시하면 빠진 쪽이 영영 안 채워진다). whoami가 던지면 캐시하지 않아 다음 이벤트에서 다시 시도한다.
      if (botId && botUserId) who = { botId, botUserId };
      else {
        const r = await whoami(token);
        if (r.botId && r.botUserId) who = { botId: r.botId, botUserId: r.botUserId };
        else return { botToken: token, botId: r.botId, botUserId: r.botUserId, teamId: source.teamId, enterpriseId: source.enterpriseId };
      }
      cache.set(token, who);
    }
    return { botToken: token, botId: who.botId, botUserId: who.botUserId, teamId: source.teamId, enterpriseId: source.enterpriseId };
  };
}
