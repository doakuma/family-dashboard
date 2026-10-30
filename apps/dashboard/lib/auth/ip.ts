// 내부망(사설 대역) 판정. 소켓 주소 문자열을 받는다. 헤더 값은 넘기지 않는다.

function parseV4(s: string): [number, number, number, number] | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return undefined;
  const parts = m.slice(1).map((x) => {
    // 앞자리 0은 8진수로 읽는 구현이 있어 모호하다 -> 거부
    if (x.length > 1 && x.startsWith("0")) return NaN;
    return Number(x);
  });
  if (parts.some((n) => !(n >= 0 && n <= 255))) return undefined;
  return parts as [number, number, number, number];
}

function isPrivateV4([a, b]: [number, number, number, number]): boolean {
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** 8개 16비트 그룹으로. 잘못된 형식이면 undefined */
function parseV6(input: string): number[] | undefined {
  let s = input;
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return undefined;
  // 끝에 점 표기 IPv4가 붙은 형태(::ffff:1.2.3.4)
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (!v4) return undefined;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return undefined;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (all.length !== 8) return undefined;
  const nums = all.map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? undefined : nums;
}

/**
 * 허용: 127/8, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7, fe80::/10, IPv4-mapped IPv6(안의 IPv4가 위 대역일 때).
 * 비어 있거나 해석할 수 없으면 false(거부).
 */
export function isPrivateIp(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const v4 = parseV4(addr);
  if (v4) return isPrivateV4(v4);
  const g = parseV6(addr);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPrivateV4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

/** custom server가 소켓 주소를 담아 주는 헤더. 밖에서 온 값은 서버가 항상 덮어쓴다. */
export const PEER_HEADER = "x-hsh-peer";

/**
 * custom server용: 요청 헤더에서 밖에서 보낸 PEER_HEADER를 지우고, 소켓 주소가 내부망이면 그 값을 담는다.
 * 내부망이 아니면 false(요청을 거부해야 한다).
 */
export function stampPeer(headers: Record<string, string | string[] | undefined>, remoteAddress: string | undefined): boolean {
  delete headers[PEER_HEADER];
  if (!isPrivateIp(remoteAddress)) return false;
  headers[PEER_HEADER] = remoteAddress;
  return true;
}
