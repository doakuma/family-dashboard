// 내부망 제한(2중 방어의 두 번째 층). 첫 층은 server.ts가 소켓 주소로 거른다.
// Next의 proxy/route handler는 소켓 주소를 직접 못 얻고, x-forwarded-for는 클라이언트가 넣은 값이 우선이라 믿을 수 없다.
// 그래서 server.ts가 소켓 주소를 PEER_HEADER에 (항상 덮어써서) 담아 주고, 여기서는 그 값만 본다.
// 헤더가 없으면(= server.ts를 거치지 않고 `next start`로 띄움) 닫는다.
import { NextResponse, type NextRequest } from "next/server";
import { PEER_HEADER, isPrivateIp } from "@/lib/auth/ip";

export function proxy(request: NextRequest) {
  if (!isPrivateIp(request.headers.get(PEER_HEADER))) {
    return new NextResponse("내부망에서만 접근할 수 있어요.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.next();
}

// 정적 파일 포함 전부 검사한다
export const config = { matcher: "/:path*" };
