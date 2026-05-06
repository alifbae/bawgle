// Topbar mute toggle. Flips the feedback module's audio-enabled
// setting (persisted to localStorage) and swaps the icon + colour so
// muted state is obvious at a glance (red speaker-off).

import { dom } from "../dom.ts";
import { isAudioEnabled, setAudioEnabled } from "./feedback.ts";

/**
 * Wire up the mute button if present. Safe to call on pages that
 * don't have the button (e.g. the share page), where dom.muteBtn
 * will be null.
 */
export function initMuteToggle(): void {
  const btn = dom.muteBtn;
  if (!btn) return;

  paint();
  btn.addEventListener("click", () => {
    setAudioEnabled(!isAudioEnabled());
    paint();
  });

  function paint(): void {
    const enabled = isAudioEnabled();
    btn!.classList.toggle("is-muted", !enabled);
    btn!.setAttribute("aria-pressed", enabled ? "false" : "true");
    btn!.setAttribute("title", enabled ? "Mute audio" : "Unmute audio");
  }
}
