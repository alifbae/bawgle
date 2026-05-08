// Svelte 5 configuration. Using vitePreprocess for TypeScript in <script>
// blocks so every component can be strongly typed without a separate
// sveltekit install. No adapter, no routing layer — Vite handles the SPA.
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
