import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/next-env.d.ts", "ecosystem.config.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/dashboard/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // 앱 코드는 설정을 ConfigProvider로 받는다(결정 0003). 아래 예외 파일만 process.env를 직접 읽는다.
    files: ["apps/**/*.{ts,tsx}"],
    ignores: ["apps/dashboard/server.ts", "apps/dashboard/proxy.ts"],
    rules: {
      "no-restricted-syntax": ["error", { selector: "MemberExpression[object.name='process'][property.name='env']", message: "process.env를 직접 읽지 말고 ConfigProvider(lib/config.ts · EnvConfigProvider)를 쓰세요." }],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", setTimeout: "readonly", URL: "readonly", Buffer: "readonly", document: "readonly", window: "readonly", getComputedStyle: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
