import { dom } from "../dom.ts";
import { isAdjacent, neighbors, type PathStore } from "./path.ts";
import { findCapUnderPoint, findCapNearPoint, pulsePress } from "../ui/board.ts";
import { flashFeedback } from "../ui/phase.ts";
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
      pulsePress(idx);
      return;
    }
    if (idx === last) {
      pulsePress(idx);
      return;
    }
    if (path.includes(idx)) {
      path.trimTo(idx);
      pulsePress(idx);
      return;
    }
    if (last !== undefined && isAdjacent(last, idx)) {
      path.push(idx);
      pulsePress(idx);
      return;
    }
    path.clear();
    path.push(idx);
    pulsePress(idx);
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
      pulsePress(idx);
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
        pulsePress(idx);
        break;
      }
    }
  }
}

// `neighbors` is imported but not used here — left as a hint for anyone
// extending this file with neighbor-based keyboard fallbacks.
void neighbors;
