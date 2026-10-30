// 내부망 제한(2중 방어의 두 번째 층). 첫 층은 server.ts가 소켓 주소·Host로 거른다.
// Next의 proxy/route handler는 소켓 주소를 직접 못 얻고, x-forwarded-for는 클라이언트가 넣은 값이 우선이라 믿을 수 없다.
// 그래서 server.ts가 소켓 주소를 PEER_HEADER에 담고 HMAC 증명을 PEER_PROOF_HEADER에 붙여 주며(밖에서 온 값은 항상 덮어씀),
// 여기서는 증명을 대조한다. 비밀값이 없거나 증명이 틀리면(= server.ts를 거치지 않고 `next start`로 띄움, 헤더 위조) 닫는다.
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, PEER_HEADER, PEER_PROOF_HEADER, PEER_SECRET_ENV, verifyPeer } from "@/lib/auth/peer";

export function proxy(request: NextRequest) {
  if (!verifyPeer(request.headers.get(PEER_HEADER), request.headers.get(PEER_PROOF_HEADER), process.env[PEER_SECRET_ENV])) {
    return new NextResponse("내부망에서만 접근할 수 있어요.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  // 레이아웃이 경로를 알 수 있게(대시보드 화면 "/"만 첫 HTML에 낮밤 톤을 넣는다) 요청 헤더에 경로를 싣는다. 클라이언트가 보낸 값은 덮어쓴다.
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

// 정적 파일 포함 전부 검사한다
export const config = { matcher: "/:path*" };
