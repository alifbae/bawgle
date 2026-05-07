// Feedback toast store. Components render it by subscribing; anything in
// the app flashes a message by calling flashFeedback(text, kind).

import { writable } from "svelte/store";

export type FeedbackKind = "ok" | "bad" | "";

interface FeedbackState {
  text: string;
  kind: FeedbackKind;
}

const store = writable<FeedbackState>({ text: "", kind: "" });
let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const feedback = {
  subscribe: store.subscribe,
};

export function flashFeedback(text: string, kind: FeedbackKind = ""): void {
  store.set({ text, kind });
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    store.set({ text: "", kind: "" });
    clearTimer = null;
  }, 1600);
}
