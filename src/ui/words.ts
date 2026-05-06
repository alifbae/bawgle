import { dom } from "../dom.ts";
import { escape } from "../util/escape.ts";
import type { RoomState } from "../../shared/types.ts";
import { scoreWord } from "../../shared/types.ts";
import { attachDefinitionTooltip } from "./definition-tooltip.ts";

let tooltipAttached = false;

export function renderMyWords(state: RoomState, meId: string | null): void {
  const me = state.players.find((p) => p.id === meId);
  const words = me?.words ?? [];
  if (dom.myCount) dom.myCount.textContent = String(words.length);
  if (!dom.myWords) return;

  // Latest finds appear first.
  dom.myWords.innerHTML = "";
  const latest = words[words.length - 1];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    const span = document.createElement("span");
    span.className = "fw";
    if (w.length >= 6) span.classList.add("fw-long");
    if (i === words.length - 1 && w === latest) span.classList.add("fw-latest");

    const wordText = document.createElement("span");
    wordText.className = "fw-text";
    wordText.textContent = w;
    span.appendChild(wordText);

    const points = document.createElement("span");
    points.className = "fw-score";
    points.textContent = `+${scoreWord(w)}`;
    span.appendChild(points);

    dom.myWords.appendChild(span);
  }
}

export function renderResults(state: RoomState, meId: string | null): void {
  dom.resultsBody.innerHTML = "";

  // One-time: install click/hover listeners on the results body so pills
  // show Wiktionary definitions on interaction.
  if (!tooltipAttached) {
    attachDefinitionTooltip(dom.resultsBody);
    tooltipAttached = true;
  }

  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;

  // Build a word -> times-found map across all players, so we can mark the
  // words only one player landed. Ignores case (words are stored lowercase
  // already, but defensive).
  const wordCounts = new Map<string, number>();
  for (const p of state.players) {
    for (const w of p.words) {
      const key = w.toLowerCase();
      wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
    }
  }

  for (const p of sorted) {
    const row = document.createElement("div");
    const isWinner = p.score === top && top > 0;
    const isMe = !!meId && p.id === meId;
    row.className = "result-row" + (isWinner ? " winner" : "") + (isMe ? " me" : "");
    const crown = isWinner ? '<span class="winner-crown" title="winner">♛</span>' : "";
    const meMark = isMe ? '<span class="me-mark">(you)</span>' : "";
    const words = [...p.words]
      .sort((a, b) => b.length - a.length || a.localeCompare(b))
      .map((w) => {
        const unique = (wordCounts.get(w.toLowerCase()) ?? 0) === 1;
        const star = unique
          ? '<span class="chip-star" title="only you found this">★</span>'
          : "";
        const cls = unique ? "chip chip-unique" : "chip";
        const pts = scoreWord(w);
        return `<span class="${cls}" data-word="${escape(w)}" role="button" tabindex="0">${star}${escape(w)}<sup class="chip-score">+${pts}</sup></span>`;
      })
      .join("");
    row.innerHTML = `
      <div class="rhead">
        <span class="pname">${crown}${escape(p.name)}${meMark}</span>
        <span class="pscore">${p.score}</span>
      </div>
      <div class="words">${
        words || '<span class="chip" style="opacity:.5">no words</span>'
      }</div>
    `;
    dom.resultsBody.appendChild(row);
  }

  const possible = state.possibleWords ?? [];
  if (possible.length > 0) {
    const found = new Set<string>();
    for (const p of state.players) for (const w of p.words) found.add(w);
    const missed = possible.filter((w) => !found.has(w));

    const panel = document.createElement("div");
    panel.className = "result-row missed collapsed";
    const missedChips = missed
      .sort((a, b) => b.length - a.length || a.localeCompare(b))
      .map((w) => {
        const pts = scoreWord(w);
        return `<span class="chip" data-word="${escape(w)}" role="button" tabindex="0">${escape(w)}<sup class="chip-score">+${pts}</sup></span>`;
      })
      .join("");
    panel.innerHTML = `
      <div class="rhead">
        <span class="pname">missed</span>
        <span class="pscore">${missed.length} / ${possible.length}</span>
      </div>
      <div class="words missed-words">${
        missedChips ||
        '<span class="chip" style="opacity:.5">everyone was thorough</span>'
      }</div>
      <button type="button" class="missed-toggle" aria-expanded="false">
        <span class="missed-toggle-label">show all</span>
        <span class="missed-toggle-icon" aria-hidden="true">▾</span>
      </button>
    `;
    panel
      .querySelector<HTMLButtonElement>(".missed-toggle")!
      .addEventListener("click", () => {
        const open = panel.classList.toggle("collapsed") === false;
        const btn = panel.querySelector<HTMLButtonElement>(".missed-toggle")!;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.querySelector(".missed-toggle-label")!.textContent = open
          ? "show less"
          : "show all";
      });
    // If the list is short enough to fit in ~5 rows anyway, hide the toggle.
    if (missed.length <= 12) {
      panel.querySelector<HTMLButtonElement>(".missed-toggle")!.hidden = true;
      panel.classList.remove("collapsed");
    }
    dom.resultsBody.appendChild(panel);
  }
}
