// Admin client build. Transpiles server/admin/assets/app.ts to app.js
// beside the source so the Node server can serve it as a static file.
//
// We intentionally do not use Vite for this — it's one file, no deps,
// no HMR needed. esbuild gives us sub-second TS-to-JS with zero config
// and no runtime baggage.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "assets");

const watch = process.argv.includes("--watch");

await build({
  entryPoints: [join(ASSETS, "app.ts")],
  outfile: join(ASSETS, "app.js"),
  bundle: true,
  // The admin client has no external runtime deps — type-only imports
  // from the server are erased by esbuild at compile time.
  format: "iife",
  target: ["es2022"],
  platform: "browser",
  sourcemap: "inline",
  minify: false,
  logLevel: "info",
});

if (watch) {
  // Best-effort watch via polling: re-invoke the build when the file
  // changes. We don't need fancy incremental contexts for a single
  // ~400-line input.
  const { watch: fsWatch } = await import("node:fs");
  const path = join(ASSETS, "app.ts");
  fsWatch(path, { persistent: true }, async () => {
    try {
      await build({
        entryPoints: [path],
        outfile: join(ASSETS, "app.js"),
        bundle: true,
        format: "iife",
        target: ["es2022"],
        platform: "browser",
        sourcemap: "inline",
        logLevel: "info",
      });
      console.log("[admin] rebuilt");
    } catch (err) {
      console.error("[admin] rebuild failed:", err);
    }
  });
  console.log("[admin] watching", path);
}
