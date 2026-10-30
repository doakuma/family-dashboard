// 주의: server.ts가 Node로 직접 불러오는 파일이라 상대 import에는 .ts 확장자를 붙인다.
// Host·Origin 허용 목록 (DNS 리바인딩 방어, 결정 기록 0002).
// 소켓 주소가 내부망이어도, 공격자 도메인이 집 내부망 IP로 풀리도록 바꾸면 브라우저가 그 도메인(Host)으로 내부 서버를 부를 수 있다.
// 그래서 Host는 우리가 아는 이름·IP 리터럴만 받는다: DASHBOARD_BASE_URL의 host, localhost/127.0.0.1/[::1], 사설 IP 리터럴.
import { resolveBaseUrl } from "./base-url.ts";
import { isPrivateIp } from "./ip.ts";

type Env = { DASHBOARD_BASE_URL?: string; NODE_ENV?: string; PORT?: string };

const defaultPort = (protocol: string) => (protocol === "https:" ? "443" : "80");

/** `host:port`·`[::1]:3000` 헤더 값을 나눈다. 잘못된 형식이면 undefined */
export function parseHostHeader(value: string | null | undefined): { hostname: string; port?: string } | undefined {
  if (!value) return undefined;
  const m = /^(\[[0-9a-fA-F:.%A-Za-z]+\]|[^\s:/?#@[\]]+)(?::(\d{1,5}))?$/.exec(value.trim());
  if (!m) return undefined;
  const raw = m[1] ?? "";
  const hostname = (raw.startsWith("[") ? raw.slice(1, -1) : raw).toLowerCase();
  return { hostname, port: m[2] };
}

/** 이 Host 헤더로 온 요청을 받아도 되는가 */
export function isAllowedHost(hostHeader: string | null | undefined, env: Env): boolean {
  const h = parseHostHeader(hostHeader);
  if (!h) return false;
  if (h.hostname === "localhost" || h.hostname === "127.0.0.1" || h.hostname === "::1") return true;
  // IP 리터럴은 DNS로 다른 곳을 가리키게 바꿀 수 없다. 이름(도메인)은 isPrivateIp가 false라서 여기서 걸러진다.
  if (isPrivateIp(h.hostname)) return true;
  const base = resolveBaseUrl(env);
  if (!base.ok) return false;
  const u = new URL(base.url);
  return h.hostname === u.hostname.replace(/^\[|\]$/g, "").toLowerCase() && (h.port ?? defaultPort(u.protocol)) === (u.port || defaultPort(u.protocol));
}

/**
 * 폼 POST의 출처 확인: Origin(없으면 Referer)의 origin이 DASHBOARD_BASE_URL의 origin과 같아야 한다.
 * 요청 Host 헤더와 비교하지 않는다(Host는 요청자가 정하는 값). 개발 모드에서만 localhost 계열을 더 받는다.
 */
export function isAllowedOrigin(from: string | null | undefined, env: Env): boolean {
  if (!from) return false;
  let origin: string;
  try {
    origin = new URL(from).origin;
  } catch {
    return false;
  }
  const allowed: string[] = [];
  const base = resolveBaseUrl(env);
  if (base.ok) allowed.push(base.url);
  if (env.NODE_ENV !== "production") {
    const port = env.PORT || "3000";
    allowed.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return allowed.includes(origin);
}
