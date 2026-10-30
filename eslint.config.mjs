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
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", setTimeout: "readonly", URL: "readonly", Buffer: "readonly", document: "readonly", window: "readonly", getComputedStyle: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
