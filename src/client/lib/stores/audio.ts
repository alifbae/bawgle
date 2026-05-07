// Small audio-enabled store on top of the audio utility module.
// Components subscribe to re-render the mute icon; the underlying
// persistence still lives in src/lib/util/audio.ts so the sound
// generation logic stays put.

import { writable } from "svelte/store";
import { isAudioEnabled, setAudioEnabled } from "../util/audio.ts";

const store = writable<boolean>(isAudioEnabled());

export const audioEnabled = {
  subscribe: store.subscribe,
};

export function toggleAudio(): void {
  store.update((enabled) => {
    const next = !enabled;
    setAudioEnabled(next);
    return next;
  });
}
