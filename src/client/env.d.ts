/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * Compile-time string injected by vite.config.js from the BAWGLE_ENVIRONMENT
 * env var. Read by Settings.svelte to relax the round-length slider
 * minimum when set to "development"; unused otherwise.
 */
declare const __BAWGLE_ENVIRONMENT__: string;
