// Tactile + audio feedback for the gameplay events that benefit from a
// sensory cue: tile selection, word submission, rejection.
//
//   - Haptics via navigator.vibrate (Android). iOS Safari doesn't expose
//     this, which is fine — silent no-op.
//   - Audio via Web Audio API using short synthesized clicks so we ship
//     no sound assets. The audio context is created lazily on first
//     user gesture (iOS requires it).
//
// Users can mute via `setAudioEnabled(false)` (persisted to
// localStorage) and we also bail out under prefers-reduced-motion.
//
// Usage from anywhere:
//   import { tap, submit, reject } from "./feedback.ts";
//   tap();
//
// Each helper is idempotent-safe to call from pointerdown, click, or
// keydown handlers — we debounce rapid triggers so holding the keyboard
// arrow keys doesn't chirp frantically.

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let lastPlayed = 0;
const MIN_INTERVAL_MS = 40;

const STORAGE_KEY = "bawgle.audio";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** User can opt out in settings. Default on for everyone. */
export function isAudioEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "off") return false;
    if (v === "on") return true;
  } catch {
    /* private mode / disabled storage */
  }
  return true;
}

export function setAudioEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    gain = ctx.createGain();
    gain.gain.value = 0.08; // headroom — we layer short envelopes on top
    gain.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Short synthesized click. `frequency` sets the pitch in Hz;
 * `duration` caps how long the envelope takes to decay to silence.
 */
function playClick(frequency: number, duration = 60): void {
  const now = Date.now();
  if (now - lastPlayed < MIN_INTERVAL_MS) return;
  lastPlayed = now;
  if (!isAudioEnabled()) return;

  const audio = ensureContext();
  if (!audio || !gain) return;
  // iOS suspends the context when first created; resume on user
  // gesture (this function is always called from one).
  if (audio.state === "suspended") {
    void audio.resume();
  }

  const t0 = audio.currentTime;
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = "triangle";
  osc.frequency.value = frequency;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(1, t0 + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration / 1000);
  osc.connect(env);
  env.connect(gain);
  osc.start(t0);
  osc.stop(t0 + duration / 1000 + 0.02);
}

function vibrate(ms: number | number[]): void {
  if (prefersReducedMotion()) return;
  if (typeof navigator === "undefined") return;
  // Chrome on desktop exposes vibrate as a no-op; iOS Safari doesn't
  // expose it at all. Both cases resolve to either a silent call or
  // undefined access, so the chained optional is safe.
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* some browsers reject from non-user gestures */
  }
}

/** Tile tap / key press. Light, high-pitched. */
export function tap(): void {
  playClick(880, 40);
  vibrate(8);
}

/** Word accepted — a slightly longer, lower tone. */
export function submit(): void {
  playClick(660, 90);
  vibrate([12, 20, 12]);
}

/** Word rejected — lower, short. Pattern of two for "nope". */
export function reject(): void {
  playClick(220, 120);
  vibrate([18, 28, 18]);
}

/**
 * Call once at boot with a user-gesture-driven event (first click/tap
 * anywhere in the app). Primes the audio context so subsequent
 * feedbacks fire instantly without a "first click is silent" gap on
 * iOS. Harmless to call repeatedly.
 */
export function primeOnFirstGesture(): void {
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    ensureContext();
    window.removeEventListener("pointerdown", arm, true);
    window.removeEventListener("keydown", arm, true);
  };
  window.addEventListener("pointerdown", arm, true);
  window.addEventListener("keydown", arm, true);
}
