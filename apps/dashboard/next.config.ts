import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/core를 TS 소스 그대로 가져온다.
  transpilePackages: ["@hsh/core"],
};

export default nextConfig;
