// ESLint flat config (v9+). Single-package layout: browser source under
// src/, Node source under server/ and scripts/, shared code under shared/.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      ".kiro/**",
      "data/dictionary/words.txt",
      "server/admin/assets/app.js",
      "pnpm-lock.yaml",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  // Browser-side code
  {
    files: ["src/**/*.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Node-side server code
  {
    files: ["server/**/*.{js,ts}", "scripts/**/*.{js,ts,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Shared shims run in both — permit both globals.
  {
    files: ["shared/**/*.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Global tweaks to match our code style.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-inner-declarations": "off",
    },
  },
];
