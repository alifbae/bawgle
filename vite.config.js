import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Surface BAWGLE_ENVIRONMENT to the client bundle as a compile-time string.
// `development` lets the Settings slider drop its minimum to 5s for fast
// iteration; production keeps the 60s floor.
const environment = process.env.BAWGLE_ENVIRONMENT || "production";

export default defineConfig({
  base: "./",
  plugins: [svelte()],
  define: {
    __BAWGLE_ENVIRONMENT__: JSON.stringify(environment),
  },
  server: {
    // Bind to 0.0.0.0 in dev so phones / tablets on the same LAN can
    // hit the app at http://<dev-machine-ip>:5175. Vite prints both
    // the local and network URLs on startup.
    host: true,
    port: 5175,
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      },
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Admin dashboard is served by the Node server, not Vite. Forward
      // the HTML route too so `pnpm dev` exposes it at
      // http://localhost:5175/admin just like production.
      "/admin": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
