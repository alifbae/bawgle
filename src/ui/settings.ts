import { dom } from "../dom.ts";
import type { RoomSettings } from "../../shared/types.ts";

type SettingsPartial = Partial<RoomSettings>;
type SendFn = (s: SettingsPartial) => void;

let send: SendFn | null = null;
let pending: SettingsPartial | null = null;
let lastSent: SettingsPartial | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function initSettings({ onChange }: { onChange: SendFn }): void {
  send = onChange;

  const segButtons = dom.sizeSelect.querySelectorAll<HTMLButtonElement>(".seg-btn");
  segButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const size = Number(btn.dataset.size) as RoomSettings["size"];
      queue({ size });
      flushImmediate();
    });
  });

  dom.roundSlider.addEventListener("input", () => {
    const v = Number(dom.roundSlider.value);
    dom.roundValue.textContent = fmt(v);
    queue({ roundSeconds: v });
  });
  dom.roundSlider.addEventListener("change", flushImmediate);
}

function queue(partial: SettingsPartial): void {
  pending = { ...(pending || {}), ...partial };
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushImmediate, 300);
}

function flushImmediate(): void {
  if (!pending || !send) return;
  const same =
    lastSent &&
    lastSent.size === pending.size &&
    lastSent.roundSeconds === pending.roundSeconds;
  if (same) {
    pending = null;
    return;
  }
  send(pending);
  lastSent = { ...pending };
  pending = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function syncSettingsInputs(settings: RoomSettings | null | undefined): void {
  if (!settings) return;
  const segButtons = dom.sizeSelect.querySelectorAll<HTMLButtonElement>(".seg-btn");
  segButtons.forEach((btn) => {
    const active = Number(btn.dataset.size) === settings.size;
    btn.setAttribute("aria-checked", active ? "true" : "false");
  });
  if (Number(dom.roundSlider.value) !== settings.roundSeconds) {
    dom.roundSlider.value = String(settings.roundSeconds);
  }
  dom.roundValue.textContent = fmt(settings.roundSeconds);
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
