// 404 page. The SPA catch-all on the server serves index.html for every
// unmatched path so an operator can open /result directly, which means
// any typo like /foo also lands here. Instead of silently dumping users
// into the lobby we detect unknown routes in main.ts and mount this
// read-only page.

import { dom } from "../dom.ts";
import { setPhase } from "./phase.ts";

export function initNotFoundPage(): void {
  document.body.classList.add("is-404-page");
  dom.lobby.classList.add("hidden");
  dom.room.classList.add("hidden");

  setPhase("results"); // reuse the results section as our scaffold

  const title = document.querySelector<HTMLElement>(".results-title");
  if (title) {
    title.textContent = "404 — page not found";
    title.classList.remove("results-meta");
  }

  dom.resultsBody.innerHTML = `
    <div class="result-empty">
      <p class="not-found-big">404</p>
      <p>The page <code>${escapePath(location.pathname)}</code> doesn't exist.</p>
      <a class="btn primary" href="./">back to bawgle</a>
    </div>
  `;

  dom.playAgainBtn.hidden = true;
  const shareBtn = document.getElementById("share-round-btn") as
    | HTMLButtonElement
    | null;
  if (shareBtn) shareBtn.hidden = true;
}

function escapePath(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[ch] ?? ch;
  });
}
