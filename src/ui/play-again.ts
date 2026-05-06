import { dom } from "../dom.ts";

// How long the play-again button stays disabled after the round ends.
// Gives players a beat to read the results before someone hammers the
// button and drags everyone back to the lobby.
const PLAY_AGAIN_LOCKOUT_MS = 5_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let unlockTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Disable the play-again button for a short lockout and count down visibly
 * inside its label. Safe to call repeatedly — each call resets the timer.
 * When the lockout ends, the button returns to its normal "play again"
 * state and becomes clickable.
 */
export function armPlayAgain(): void {
  const btn = dom.playAgainBtn;
  cancelTimers();

  const endsAt = Date.now() + PLAY_AGAIN_LOCKOUT_MS;
  btn.disabled = true;
  btn.classList.add("cooling");

  const paint = () => {
    const remainingMs = Math.max(0, endsAt - Date.now());
    const secs = Math.ceil(remainingMs / 1000);
    btn.textContent = secs > 0 ? `play again (${secs})` : "play again";
    btn.setAttribute("aria-disabled", secs > 0 ? "true" : "false");
  };
  paint();

  tickTimer = setInterval(paint, 200);
  unlockTimer = setTimeout(() => {
    cancelTimers();
    btn.disabled = false;
    btn.classList.remove("cooling");
    btn.textContent = "play again";
    btn.removeAttribute("aria-disabled");
  }, PLAY_AGAIN_LOCKOUT_MS);
}

/** Clear any in-flight cooldown — used on leaving results phase. */
export function disarmPlayAgain(): void {
  cancelTimers();
  const btn = dom.playAgainBtn;
  btn.disabled = false;
  btn.classList.remove("cooling");
  btn.textContent = "play again";
  btn.removeAttribute("aria-disabled");
}

function cancelTimers(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (unlockTimer) {
    clearTimeout(unlockTimer);
    unlockTimer = null;
  }
}
