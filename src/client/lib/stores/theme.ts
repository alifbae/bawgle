// Theme cycling, backed by the existing themes.ts CSS-var palette.
// The store holds the current theme key; subscribers render its name.
// Cycling is a simple next-key-in-alphabetical-order operation.

import { writable } from "svelte/store";
import { THEMES, applyTheme, loadTheme } from "../util/themes.ts";

const keys = Object.keys(THEMES).sort((a, b) =>
  THEMES[a].name.localeCompare(THEMES[b].name),
);

function initial(): string {
  // loadTheme() reads from localStorage, applies the palette, and
  // returns the key it landed on.
  const k = loadTheme();
  return keys.includes(k) ? k : keys[0];
}

const store = writable<string>(initial());

export const themeKey = {
  subscribe: store.subscribe,
};

export function cycleTheme(): void {
  store.update((cur) => {
    const idx = keys.indexOf(cur);
    const next = keys[(idx + 1) % keys.length];
    applyTheme(next);
    return next;
  });
}

export function themeName(key: string): string {
  return THEMES[key]?.name ?? key;
}
