// QR 주소의 기준. Host 헤더는 요청자가 바꿀 수 있어서 쓰지 않는다.
export type BaseUrl = { ok: true; url: string } | { ok: false; reason: "missing" | "invalid" };

/** 주소 판단에 필요한 설정(AppConfig의 일부). 이 파일은 server.ts가 직접 불러오므로 @hsh/core 값 import를 쓰지 않는다. */
export interface NetConfig {
  dashboardBaseUrl?: string;
  nodeEnv?: string;
  port?: number;
}

export function resolveBaseUrl(cfg: NetConfig): BaseUrl {
  const raw = cfg.dashboardBaseUrl?.trim();
  if (!raw) {
    // 개발 모드에서만 localhost로 대신한다. 운영에서 조용히 localhost QR을 보여 주면 휴대폰에서 안 열린다.
    if (cfg.nodeEnv === "production") return { ok: false, reason: "missing" };
    return { ok: true, url: `http://localhost:${cfg.port || 3000}` };
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "invalid" };
    return { ok: true, url: u.origin };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
