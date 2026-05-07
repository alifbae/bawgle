// ESLint flat config (v9+). Single-package layout: browser source under
// src/, Node source under server/ and scripts/, shared code under shared/.
// Svelte components under src/lib and src/App.svelte are linted with
// eslint-plugin-svelte so <script lang="ts"> blocks are understood.
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
      "server/admin/assets/app.js",
      "pnpm-lock.yaml",
      // MkDocs-built static site (search worker, assets). Not our source.
      "docs/site/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...sveltePlugin.configs.recommended,
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
      // Components freely use $$props-style callback typings that
      // don't play with the strict any ban; keep that as a warning.
      "@typescript-eslint/no-explicit-any": "warn",
      // Derived map/set reads are fine — the `$derived.by` rebuilds
      // them whenever the state they read from changes, so manual
      // reactive-aware Map/Set variants aren't required.
      "svelte/prefer-svelte-reactivity": "off",
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
      "no-undef": "off",
    },
  },
];
