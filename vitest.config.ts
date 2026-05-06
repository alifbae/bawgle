// Vitest config. Two test environments live side by side:
//
//   - server-side tests run in Node (default)
//   - browser-side tests opt in via a top-of-file annotation:
//
//   // @vitest-environment jsdom
//
// Coverage is opt-in via --coverage.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default to Node; individual files override to jsdom when they need
    // window / localStorage / DOM APIs.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The dictionary/storage tests do real file I/O to a tmp dir. Keep
    // each test file single-threaded against its own fixtures.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: false },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["server/**/*.ts", "shared/**/*.ts", "src/**/*.ts"],
      exclude: [
        "tests/**",
        "**/*.test.ts",
        "server/admin/assets/**",
        "server/admin/build.ts",
        "src/main.ts", // glue, exercised by e2e not unit
      ],
    },
  },
});
