// Board preview on the results screen.
//
// Renders the final board read-only inside the results section so
// players can see the tiles after the round, and wires event
// delegation on the results body so hovering or tapping a word-chip
// traces its path on the board. Reuses the same board rendering and
// trail drawing used during live play so the visuals match.
//
// Interaction model:
//   - hover a chip          → preview its path (transient)
//   - pointer leaves chip   → revert to the pinned path, or clear
//   - click/tap a chip      → pin its path; survives pointer-out
//   - tap another chip      → replace the pinned path
//   - tap anywhere outside  → clear the pin
//
// Rendered into a dedicated second board element (#results-board)
// separate from the live playing board. That way we don't have to
// juggle visibility of the main board when switching phases and we
// don't clobber any trail it might be showing.

import { dom } from "../dom.ts";
import {
  applyPathUI,
  clearTrail,
  drawTrail,
  renderBoard,
  type BoardTargets,
} from "./board.ts";
import { findPathForWord } from "../game/resolver.ts";

let listenersInstalled = false;
let currentBoard: string[] | null = null;
/** Word that's pinned (via click) and should persist between hovers. */
let pinnedWord: string | null = null;

function targets(): BoardTargets {
  return { board: dom.resultsBoard, trail: dom.resultsBoardTrail };
}

/**
 * Mount the board preview + enable hover/click highlighting on any
 * `[data-word]` chip inside `root` (typically `dom.resultsBody`).
 *
 * Idempotent — listeners attach at most once and stick around for
 * subsequent calls (chips get re-rendered by renderResults so we can't
 * bind directly to them anyway).
 */
export function installResultsPreview(
  board: string[] | null,
  size: 4 | 5 | 6,
  root: HTMLElement = dom.resultsBody,
): void {
  currentBoard = board;
  pinnedWord = null;

  dom.resultsBoardWrap.hidden = false;
  renderBoard(board, size, targets());
  clearHighlight();

  if (listenersInstalled) return;
  listenersInstalled = true;

  // Delegation: chips carry `data-word`. We attach to the enclosing
  // results section so new chips on each renderResults re-run still
  // benefit.
  const host = root.closest("section") ?? root;

  host.addEventListener(
    "pointerover",
    (e) => {
      const chip = targetChip(e);
      if (chip) showWord(chip.getAttribute("data-word") || "");
    },
    true,
  );
  host.addEventListener(
    "pointerout",
    (e) => {
      // If the pointer left the chip (or left the host entirely), revert
      // to whatever's pinned. relatedTarget tells us where we went.
      const leavingChip = targetChip(e);
      if (!leavingChip) return;
      const next = e.relatedTarget instanceof Element
        ? e.relatedTarget.closest<HTMLElement>("[data-word]")
        : null;
      if (next && next === leavingChip) return; // still over the same chip
      showPinned();
    },
    true,
  );

  // Click: pin the tapped chip's path, or clear if they tapped empty space.
  host.addEventListener("click", (e) => {
    const chip = targetChip(e);
    if (chip) {
      pinnedWord = chip.getAttribute("data-word") || null;
      showPinned();
      return;
    }
    // Tapped something that isn't a chip → clear the pin.
    pinnedWord = null;
    clearHighlight();
  });

  // Keyboard: focus = hover, blur = revert to pin. Enter/Space triggers
  // the browser's native click path for buttons so the click handler
  // above handles pinning.
  host.addEventListener("focusin", (e) => {
    const chip = targetChip(e);
    if (chip) showWord(chip.getAttribute("data-word") || "");
  });
  host.addEventListener("focusout", (e) => {
    const chip = targetChip(e);
    if (chip) showPinned();
  });

  // Tapping completely outside the results section also clears the pin.
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    if (host.contains(e.target)) return; // handled by in-host listener
    pinnedWord = null;
    clearHighlight();
  });
}

/**
 * Tear down the preview. Hides the board and clears highlight state.
 * Safe to call when no preview is installed.
 */
export function uninstallResultsPreview(): void {
  dom.resultsBoardWrap.hidden = true;
  currentBoard = null;
  pinnedWord = null;
  clearHighlight();
}

function targetChip(e: Event): HTMLElement | null {
  const t = e.target;
  if (!(t instanceof Element)) return null;
  return t.closest<HTMLElement>("[data-word]");
}

function showWord(word: string): void {
  if (!word || !currentBoard) return;
  const path = findPathForWord(currentBoard, word);
  if (!path) return;
  applyPathUI(path, targets());
  drawTrail(path, targets());
  markActive(word);
}

function showPinned(): void {
  if (pinnedWord) {
    showWord(pinnedWord);
  } else {
    clearHighlight();
  }
}

function clearHighlight(): void {
  applyPathUI([], targets());
  clearTrail(targets());
  markActive(null);
}

/**
 * Add a persistent class to the currently-active chip so the CSS can
 * style it differently from transient hovers. Cleared when no chip is
 * active.
 */
function markActive(word: string | null): void {
  const host =
    dom.resultsBody.closest("section") ?? dom.resultsBody;
  host.querySelectorAll<HTMLElement>("[data-word].is-active")
    .forEach((el) => el.classList.remove("is-active"));
  if (!word) return;
  // Match chips case-insensitively since data-word preserves casing.
  const lower = word.toLowerCase();
  host.querySelectorAll<HTMLElement>("[data-word]").forEach((el) => {
    if ((el.getAttribute("data-word") || "").toLowerCase() === lower) {
      el.classList.add("is-active");
    }
  });
}
