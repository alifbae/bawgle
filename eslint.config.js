// ESLint flat config (v9+). Tree layout after the monorepo-in-src
// reorg:
//
//   src/client/       — browser SPA (Svelte + TS)
//   src/server/       — Node server (Hono, better-sqlite3, ws)
//   src/admin-panel/  — admin dashboard (Node routes + plain-DOM client)
//   src/shared/       — types shared between server and client
//
// Each slice gets its own globals config so Node-only source doesn't
// see `window`, and vice versa.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import sveltePlugin from "eslint-plugin-svelte";
import globals from "globals";
import svelteParser from "svelte-eslint-parser";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      ".kiro/**",
      "data/dictionary/words.txt",
      // Compiled admin client bundle (built by tsx src/admin-panel/build.ts).
      "src/admin-panel/assets/app.js",
      "pnpm-lock.yaml",
      // MkDocs-built static site (search worker, assets). Not our source.
      "docs/site/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...sveltePlugin.configs.recommended,
  prettier,

  // Browser-side code (Svelte SPA + the plain-DOM admin client).
  {
    files: [
      "src/client/**/*.{js,ts}",
      "src/admin-panel/assets/**/*.{js,ts}",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Svelte single-file components: use the Svelte parser and delegate
  // <script> contents to typescript-eslint.
  {
    files: ["src/**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Components freely use $props-style callback typings that
      // don't play with the strict any ban; keep that as a warning.
      "@typescript-eslint/no-explicit-any": "warn",
      // Derived map/set reads are fine — `$derived.by` rebuilds them
      // whenever the state they read from changes, so reactive
      // Map/Set variants aren't required.
      "svelte/prefer-svelte-reactivity": "off",
    },
  },

  // Node-side code: server, admin-panel host process, one-off scripts.
  // The admin-panel/assets/ subtree is browser code and is covered by
  // the browser block above instead.
  {
    files: [
      "src/server/**/*.{js,ts}",
      "src/admin-panel/*.{js,ts}",
      "scripts/**/*.{js,ts,mjs}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Build and test configuration files that run in Node during
  // build/test. Not part of the shipped bundles.
  {
    files: [
      "vite.config.{js,ts}",
      "vitest.config.{js,ts}",
      "eslint.config.{js,ts}",
      "svelte.config.{js,ts}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Tests run in Node (vitest), with jsdom opt-in per file. Let them
  // use Node globals and, for jsdom-mode tests, browser globals too.
  {
    files: ["tests/**/*.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Shared types / helpers used by both server and client.
  {
    files: ["src/shared/**/*.{js,ts}"],
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
      "no-undef": "off",
    },
  },
];
