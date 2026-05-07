/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * Compile-time string injected by vite.config.js from the BAWGLE_ENVIRONMENT
 * env var. "development" unlocks window.bawgleDev; anything else is treated
 * as production and the dev-helpers module is tree-shaken out.
 */
declare const __BAWGLE_ENVIRONMENT__: string;
