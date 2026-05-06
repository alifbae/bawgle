import { dom } from "../dom.ts";
import { isAdjacent, neighbors, type PathStore } from "./path.ts";
import { findCapUnderPoint, findCapNearPoint, pulsePress } from "../ui/board.ts";
import { flashFeedback } from "../ui/phase.ts";
import { tap } from "../ui/feedback.ts";
import { findPathForWord } from "./resolver.ts";

export interface AttachInputOptions {
  path: PathStore;
  onSubmit: () => void;
  getBoard: () => string[] | null | undefined;
  getPhase: () => string | undefined;
}

/**
 * Wires pointer (touch/mouse) and keyboard input to a path store.
 *
 * Pointer gestures manipulate the path directly (sliding/tapping tiles).
 * Keyboard typing builds a typed-word buffer and uses the resolver to find a
 * matching path on the board with full lookahead.
 */
export function attachInput({
  path,
  onSubmit,
  getBoard,
  getPhase,
}: AttachInputOptions): void {
  let pointerActive = false;
  let _pointerStartIdx = -1;
  let pointerLastIdx = -1;
  let pointerMoved = false;
  let tappedOnEnd = false;

  // Typed-word buffer from keystrokes. Cleared whenever the user drags/taps.
  let typed = "";

  const board = dom.board;

  /* ---------- Pointer ---------- */

  board.addEventListener("pointerdown", (e: PointerEvent) => {
    if (getPhase() !== "playing") return;
    const idx = findCapUnderPoint(e.clientX, e.clientY);
    if (idx === -1) return;
    e.preventDefault();
    pointerActive = true;
    pointerMoved = false;
    _pointerStartIdx = idx;
    pointerLastIdx = idx;
    typed = "";
    try {
      board.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const last = path.last();
    tappedOnEnd = last !== undefined && idx === last;

    if (path.length() === 0) {
      path.push(idx);
      pressTile(idx);
      return;
    }
    if (idx === last) {
      pressTile(idx);
      return;
    }
    if (path.includes(idx)) {
      path.trimTo(idx);
      pressTile(idx);
      return;
    }
    if (last !== undefined && isAdjacent(last, idx)) {
      path.push(idx);
      pressTile(idx);
      return;
    }
    path.clear();
    path.push(idx);
    pressTile(idx);
  });

  board.addEventListener("pointermove", (e: PointerEvent) => {
    if (!pointerActive) return;
    const idx = findCapNearPoint(e.clientX, e.clientY, 0.6);
    if (idx === -1) return;
    if (idx === pointerLastIdx) return;
    pointerMoved = true;
    pointerLastIdx = idx;

    const last = path.last();
    if (idx === last) return;
    if (path.includes(idx)) {
      path.trimTo(idx);
      return;
    }
    if (last !== undefined && isAdjacent(last, idx)) {
      path.push(idx);
      pressTile(idx);
    }
  });

  board.addEventListener("pointerup", () => {
    if (!pointerActive) return;
    pointerActive = false;

    if (pointerMoved) {
      onSubmit();
      typed = "";
    } else if (tappedOnEnd) {
      // Tap on already-last tile = deselect it.
      path.pop();
    }

    _pointerStartIdx = -1;
    pointerLastIdx = -1;
    pointerMoved = false;
    tappedOnEnd = false;
  });

  board.addEventListener("pointercancel", () => {
    pointerActive = false;
    pointerMoved = false;
    _pointerStartIdx = -1;
    pointerLastIdx = -1;
    tappedOnEnd = false;
  });

  /* ---------- Tap-outside clears the path ---------- */
  //
  // During a round, tapping anywhere that isn't the board or one of
  // the interactive word-bar controls clears whatever's in progress.
  // On mobile this is the natural "oh, never mind" gesture — you don't
  // want a half-built word to persist when the user taps a player
  // pill or just the page background to scroll.
  //
  // We listen for pointerdown (not click) so it fires immediately,
  // even if the tap lands on a non-clickable element. A small
  // allowlist of elements the user might legitimately want to tap
  // without wiping the path is exempted.
  document.addEventListener("pointerdown", (e: PointerEvent) => {
    if (getPhase() !== "playing") return;
    if (path.length() === 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    // Tap on the board or its children: handled by the board's own
    // pointerdown listener above.
    if (dom.board.contains(target)) return;

    // Word-bar controls (submit, undo, the current-word display
    // itself). Tapping "submit" should of course not wipe the word
    // we're submitting.
    if (dom.wordBar.contains(target)) return;

    // Feedback toast and interactive chrome elsewhere on the page.
    if (target.closest("button, a, input, select, textarea, [role='button']")) {
      return;
    }

    // Everything else: clear the in-progress path.
    typed = "";
    path.clear();
  });

  /* ---------- Keyboard ---------- */

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (getPhase() === "playing") {
        typed = "";
        path.clear();
        e.preventDefault();
      }
      return;
    }
    if (getPhase() !== "playing") return;

    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      active !== dom.wordInput &&
      active.tagName === "INPUT" &&
      (active as HTMLInputElement).type !== "hidden"
    ) {
      return;
    }

    if (e.key === "Enter") {
      if (path.length() > 0) {
        e.preventDefault();
        onSubmit();
        typed = "";
      }
      return;
    }
    if (e.key === "Backspace") {
      if (typed.length > 0) {
        typed = typed.slice(0, -1);
        resolveTypedToPath(typed);
      } else if (path.length() > 0) {
        path.pop();
      }
      e.preventDefault();
      return;
    }
    if (e.key.length !== 1 || !/^[a-zA-Z]$/.test(e.key)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    e.preventDefault();

    // Seed typed buffer from current path if pointer was used earlier.
    if (typed.length === 0 && path.length() > 0) {
      typed = path.wordText(getBoard());
    }

    typed += e.key.toLowerCase();
    resolveTypedToPath(typed);
  });

  function resolveTypedToPath(word: string): void {
    const board = getBoard();
    if (!board) return;
    if (word.length === 0) {
      path.clear();
      return;
    }
    const prefer = path.get();
    const result = findPathForWord(board, word, prefer);
    if (!result) {
      typed = word.slice(0, -1);
      flashFeedback("no path for that word", "bad");
      return;
    }
    const existing = new Set(path.get());
    path.set(result);
    for (const idx of result) {
      if (!existing.has(idx)) {
        pressTile(idx);
        break;
      }
    }
  }
}

/** Haptic+audio+visual pulse for a tile landing. Central so we never
    drift between handlers — typed resolve, tap, or drag all agree. */
function pressTile(idx: number): void {
  pulsePress(idx);
  tap();
}

// `neighbors` is imported but not used here — left as a hint for anyone
// extending this file with neighbor-based keyboard fallbacks.
void neighbors;
