<!--
  Read-only board preview on the results screen.
  Parent sets `highlightWord` based on chip hover/click; we resolve
  the word's path on the stored board and drive a local PathStore.

  Uses the same <Board> component as live play so styling stays
  consistent.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import Board from "./Board.svelte";
  import { createPathStore } from "../stores/path.ts";
  import { findPathForWord } from "../../game/resolver.ts";

  type Props = {
    board: string[] | null;
    size: 4 | 5 | 6;
    highlightWord?: string | null;
  };

  let { board, size, highlightWord = null }: Props = $props();

  const path = createPathStore();

  $effect(() => {
    // Untrack board/size so only a changed highlightWord re-runs this.
    const b = untrack(() => board);
    if (!b) {
      path.clear();
      return;
    }
    if (!highlightWord) {
      path.clear();
      return;
    }
    const solved = findPathForWord(b, highlightWord);
    if (!solved) {
      path.clear();
      return;
    }
    path.set(solved);
  });
</script>

<div class="board-wrap results-board-wrap">
  <Board {board} {size} {path} readOnly />
</div>

<!-- Styles shared via global results.css / board.css. -->
