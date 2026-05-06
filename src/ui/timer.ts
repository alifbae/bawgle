import { dom } from "../dom.ts";

let tickerId: ReturnType<typeof setInterval> | null = null;
// The full round length the timer was started with. Lets us compare
// remaining time to it as a fraction without re-plumbing through state.
let totalMs = 0;

export function startTicker(getEndsAt: () => number | null | undefined): void {
  stopTicker();
  dom.timer.classList.remove("low");

  const initialEnd = getEndsAt();
  totalMs = initialEnd ? Math.max(1, initialEnd - Date.now()) : 0;

  const update = () => {
    const endsAt = getEndsAt();
    if (!endsAt) return;
    const remain = Math.max(0, endsAt - Date.now());
    const s = Math.floor(remain / 1000);
    dom.timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    // Flag the last 15% of the round so CSS can turn it red and pulse.
    dom.timer.classList.toggle("low", totalMs > 0 && remain <= totalMs * 0.15);
  };
  update();
  tickerId = setInterval(update, 250);
}

export function stopTicker(): void {
  if (tickerId) clearInterval(tickerId);
  tickerId = null;
}

export function resetTimer(): void {
  dom.timer.textContent = "00:00";
  dom.timer.classList.remove("low");
}
