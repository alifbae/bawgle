<!--
  Read-only board preview on the results screen.
  Parent sets `highlightWord` based on chip hover/click; we resolve
  the word's path on the stored board and reveal it one cell at a
  time so the user can see the letter order.

  Uses the same <Board> component as live play so tile styling stays
  consistent. The board re-renders the SVG trail on every path
  update, which means staggering path.set() calls gives us both the
  letter-by-letter tile fill AND a progressively growing trail line
  for free.
-->
<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import Board from "./Board.svelte";
  import { createPathStore } from "../stores/path.ts";
  import { findPathForWord } from "../util/resolver.ts";

  type Props = {
    board: string[] | null;
    size: 4 | 5 | 6;
    highlightWord?: string | null;
  };

  let { board, size, highlightWord = null }: Props = $props();

  const path = createPathStore();

  // Cadence for the reveal stagger. Short enough that a four-letter
  // word lands in under half a second (so the UI doesn't feel slow),
  // long enough that the eye can follow the letter order.
  const STEP_MS = 90;

  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelReveal(): void {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    );
  }

  /**
   * Reveal a path one cell at a time. Sets the path to a slice of
   * length 1, 2, 3, ... on `STEP_MS` intervals. Safe against rapid
   * word switches because the next invocation cancels the pending
   * timer before starting over.
   */
  function revealStaggered(indices: number[]): void {
    cancelReveal();
    if (prefersReducedMotion() || indices.length <= 1) {
      path.set(indices);
      return;
    }
    path.set(indices.slice(0, 1));
    let step = 2;
    const tick = () => {
      if (step > indices.length) {
        pendingTimer = null;
        return;
      }
      path.set(indices.slice(0, step));
      step += 1;
      pendingTimer = setTimeout(tick, STEP_MS);
    };
    pendingTimer = setTimeout(tick, STEP_MS);
  }

  $effect(() => {
    // Untrack board/size so only a changed highlightWord re-runs this.
    const b = untrack(() => board);
    if (!b || !highlightWord) {
      cancelReveal();
      path.clear();
      return;
    }
    const solved = findPathForWord(b, highlightWord);
    if (!solved) {
      cancelReveal();
      path.clear();
      return;
    }
    revealStaggered(solved);
  });

  onDestroy(() => cancelReveal());
</script>

<div class="board-wrap results-board-wrap">
  <Board {board} {size} {path} readOnly />
</div>

<!-- Styles shared via global results.css / board.css. -->
