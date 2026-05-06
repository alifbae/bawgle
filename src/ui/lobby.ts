import { dom } from "../dom.ts";
import { flashFeedback } from "./phase.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // skip ambiguous 0/O/1/I

export interface LobbySubmit {
  code: string;
  name: string;
}

export interface InitLobbyOptions {
  onSubmit: (s: LobbySubmit) => void;
}

export function initLobby({ onSubmit }: InitLobbyOptions): void {
  // Tab toggle
  dom.tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab ?? "host"));
  });

  // Host: generate a random code on load; reroll button regenerates
  dom.hostCodeInput.value = randomCode();
  dom.rerollBtn.addEventListener("click", () => {
    dom.hostCodeInput.value = randomCode();
  });

  // Icon-only button next to the host code: copy just the code (not the link).
  dom.copyCodeBtn.addEventListener("click", async () => {
    const code = dom.hostCodeInput.value.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      flashFeedback("code copied", "ok");
    } catch {
      window.prompt("Copy room code:", code);
    }
  });

  dom.hostBtn.addEventListener("click", () => {
    const code = dom.hostCodeInput.value.trim().toUpperCase();
    const name = readName();
    if (!name) {
      flashFeedback("enter a name", "bad");
      dom.nameInput.focus();
      return;
    }
    if (!code) return;
    onSubmit({ code, name });
  });

  dom.joinBtn.addEventListener("click", () => {
    const code = dom.joinCodeInput.value.trim().toUpperCase();
    const name = readName();
    if (!name) {
      flashFeedback("enter a name", "bad");
      dom.nameInput.focus();
      return;
    }
    if (!code) {
      dom.joinCodeInput.focus();
      return;
    }
    onSubmit({ code, name });
  });

  // Restore last-used name (if any). Empty by default for first-time visitors.
  dom.nameInput.value = (sessionStorage.getItem("bawgle.name") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);

  // Uppercase + alphanumeric-only as you type.
  dom.nameInput.addEventListener("input", () => {
    const raw = dom.nameInput.value;
    const pos = dom.nameInput.selectionStart;
    const clean = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    if (clean !== raw) {
      dom.nameInput.value = clean;
      if (pos !== null) {
        const newPos = Math.min(pos, clean.length);
        dom.nameInput.setSelectionRange(newPos, newPos);
      }
    }
  });

  // Uppercase + alphanumeric + max 4 chars as you type on the join input.
  dom.joinCodeInput.addEventListener("input", () => {
    const raw = dom.joinCodeInput.value;
    const pos = dom.joinCodeInput.selectionStart;
    const clean = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    if (clean !== raw) {
      dom.joinCodeInput.value = clean;
      if (pos !== null) {
        const newPos = Math.min(pos, clean.length);
        dom.joinCodeInput.setSelectionRange(newPos, newPos);
      }
    }
  });

  // If a ?room= param is present, flip to the join tab and prefill. Sanitize
  // the value so a corrupted/truncated share (e.g. macOS Share sheet that
  // appended extra text) can't land garbage in the code field.
  const params = new URLSearchParams(location.search);
  const incoming = (params.get("room") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  if (incoming) {
    dom.joinCodeInput.value = incoming;
    selectTab("join");
  }
}

function selectTab(name: string): void {
  dom.tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  dom.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== name);
  });
}

function readName(): string {
  const raw = (dom.nameInput.value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  if (!raw) return "";
  sessionStorage.setItem("bawgle.name", raw);
  return raw;
}

function randomCode(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Share the invite link. On mobile (with Web Share API) this opens the
 * native share sheet so the user can pick WhatsApp, Messages, Mail, etc.
 * On desktop / anywhere without share support, it copies the URL to the
 * clipboard and flashes a confirmation.
 */
export async function copyInviteLink(): Promise<boolean> {
  const link = location.href;
  const canShare =
    typeof navigator.share === "function" &&
    (!("canShare" in navigator) || (navigator as Navigator).canShare?.({ url: link }));

  if (canShare) {
    try {
      // url-only: some platforms (macOS Safari, iOS Messages) concatenate
      // `text` + `url` when the user picks "Copy" from the share sheet,
      // which yields garbage like "join my bawgle room https://...".
      await navigator.share({ url: link });
      return true;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return false;
      // fall through to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(link);
    flashFeedback("invite link copied", "ok");
    return true;
  } catch {
    window.prompt("Copy invite link:", link);
    return false;
  }
}
