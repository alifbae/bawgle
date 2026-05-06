import { defineConfig } from "vite";

// Surface BAWGLE_ENVIRONMENT to the client bundle as a compile-time string.
// `development` turns on window.bawgleDev helpers; anything else strips them.
const environment = process.env.BAWGLE_ENVIRONMENT || "production";

export default defineConfig({
  base: "./",
  define: {
    __BAWGLE_ENVIRONMENT__: JSON.stringify(environment),
  },
  server: {
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
