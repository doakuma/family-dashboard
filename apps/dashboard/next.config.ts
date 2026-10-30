import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/core를 TS 소스 그대로 가져온다.
  transpilePackages: ["@hsh/core"],
  // /setup, /settings에서 인증 실패를 403으로 돌려주려고 forbidden()을 쓴다
  experimental: { authInterrupts: true },
  async headers() {
    // QR 주소에 토큰이 들어 있어서 다른 사이트로 Referer가 새지 않게 한다(no-referrer는 폼 POST의 Origin을 "null"로 만들어 출처 확인이 깨진다)
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "same-origin" }] }];
  },
};

export default nextConfig;
