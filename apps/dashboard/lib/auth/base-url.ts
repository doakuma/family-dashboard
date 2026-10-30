// QR 주소의 기준. Host 헤더는 요청자가 바꿀 수 있어서 쓰지 않는다.
export type BaseUrl = { ok: true; url: string } | { ok: false; reason: "missing" | "invalid" };

export function resolveBaseUrl(env: { DASHBOARD_BASE_URL?: string; NODE_ENV?: string; PORT?: string }): BaseUrl {
  const raw = env.DASHBOARD_BASE_URL?.trim();
  if (!raw) {
    // 개발 모드에서만 localhost로 대신한다. 운영에서 조용히 localhost QR을 보여 주면 휴대폰에서 안 열린다.
    if (env.NODE_ENV === "production") return { ok: false, reason: "missing" };
    return { ok: true, url: `http://localhost:${env.PORT || 3000}` };
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "invalid" };
    return { ok: true, url: u.origin };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
