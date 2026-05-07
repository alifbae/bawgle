// Pointer + keyboard input wiring. Identical semantics to the old
// attachInput(), but now it targets a Svelte Board component's root
// element and a PathStore — rather than the legacy `dom.*` globals.
//
// Pointer gestures manipulate the path directly (sliding, tapping).
// Keyboard typing builds a typed-word buffer and uses the resolver to
// find a matching path with full lookahead.

import { findPathForWord } from "../game/resolver.ts";
import { isAdjacent, neighbors } from "./stores/adjacency.ts";
import { tap } from "../ui/feedback.ts";
import type { PathStore } from "./stores/path.ts";
import { flashFeedback } from "./stores/feedback.ts";

export interface AttachInputOptions {
  boardEl: HTMLElement;
  wordBarEl?: HTMLElement | null;
  path: PathStore;
  onSubmit: () => void;
  getBoard: () => string[] | null | undefined;
  getPhase: () => string | undefined;
  /** Called after a tile lands from a gesture — parent bumps a token
   *  so the Board component animates the press. */
  onPress?: (index: number) => void;
  /** Hit-testers supplied by the Board component. */
  findCapUnderPoint: (x: number, y: number) => number;
  findCapNearPoint: (x: number, y: number, tolerance?: number) => number;
}

export function attachInput(opts: AttachInputOptions): () => void {
  const {
    boardEl,
    wordBarEl,
    path,
    onSubmit,
    getBoard,
    getPhase,
    onPress,
    findCapUnderPoint,
    findCapNearPoint,
  } = opts;

  let pointerActive = false;
  let pointerLastIdx = -1;
  let pointerMoved = false;
  let tappedOnEnd = false;

  let typed = "";

  function pressTile(idx: number): void {
    onPress?.(idx);
    tap();
  }

  /* ---------- Pointer ---------- */

  const onBoardPointerDown = (e: PointerEvent) => {
    if (getPhase() !== "playing") return;
    const idx = findCapUnderPoint(e.clientX, e.clientY);
    if (idx === -1) return;
    e.preventDefault();
    pointerActive = true;
    pointerMoved = false;
    pointerLastIdx = idx;
    typed = "";
    try {
      boardEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
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
  };

  const onBoardPointerMove = (e: PointerEvent) => {
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
  };

  const onBoardPointerUp = () => {
    if (!pointerActive) return;
    pointerActive = false;
    if (pointerMoved) {
      onSubmit();
      typed = "";
    } else if (tappedOnEnd) {
      path.pop();
    }
    pointerLastIdx = -1;
    pointerMoved = false;
    tappedOnEnd = false;
  };

  const onBoardPointerCancel = () => {
    pointerActive = false;
    pointerMoved = false;
    pointerLastIdx = -1;
    tappedOnEnd = false;
  };

  boardEl.addEventListener("pointerdown", onBoardPointerDown);
  boardEl.addEventListener("pointermove", onBoardPointerMove);
  boardEl.addEventListener("pointerup", onBoardPointerUp);
  boardEl.addEventListener("pointercancel", onBoardPointerCancel);

  /* ---------- Tap-outside clears the path ---------- */

  const onDocPointerDown = (e: PointerEvent) => {
    if (getPhase() !== "playing") return;
    if (path.length() === 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (boardEl.contains(target)) return;
    if (wordBarEl && wordBarEl.contains(target)) return;
    if (target.closest("button, a, input, select, textarea, [role='button']")) {
      return;
    }
    typed = "";
    path.clear();
  };
  document.addEventListener("pointerdown", onDocPointerDown);

  /* ---------- Keyboard ---------- */

  const onKeyDown = (e: KeyboardEvent) => {
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

    if (typed.length === 0 && path.length() > 0) {
      typed = path.wordText(getBoard());
    }
    typed += e.key.toLowerCase();
    resolveTypedToPath(typed);
  };

  window.addEventListener("keydown", onKeyDown);

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

  // Unused-import hint — `neighbors` is part of the input surface area
  // via findPathForWord → path.ts; reference it here so the dep graph
  // is obvious.
  void neighbors;

  return () => {
    boardEl.removeEventListener("pointerdown", onBoardPointerDown);
    boardEl.removeEventListener("pointermove", onBoardPointerMove);
    boardEl.removeEventListener("pointerup", onBoardPointerUp);
    boardEl.removeEventListener("pointercancel", onBoardPointerCancel);
    document.removeEventListener("pointerdown", onDocPointerDown);
    window.removeEventListener("keydown", onKeyDown);
  };
}
