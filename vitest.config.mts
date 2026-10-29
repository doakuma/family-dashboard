import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/bot/**/*.test.ts"],
    env: { TZ: "Asia/Seoul" },
  },
});
