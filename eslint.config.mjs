import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".venv/**",
      "out/**",
      ".next/**",
      "dist/**",
      "build/**",
      "backend/**",
      "zynk/**",
      "db/**",
      "examples/**",
      "tests/artifacts/**",
      "covalt-toolset/**",
      "public/**",
      "app/routeTree.gen.ts",
      "app/python/api.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react/display-name": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-extra-boolean-cast": "warn",
      "no-control-regex": "warn",
      "no-prototype-builtins": "warn",
      "prefer-const": "warn",
      "preserve-caught-error": "off",
    },
  },
);
