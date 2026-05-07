<!--
  Below-board input row: current word display, undo, submit.
  Visible during play. Undo/submit hide (via visibility so the row
  height stays stable) when the path is empty.
-->
<script lang="ts">
  import type { PathStore } from "../stores/path.ts";

  type Props = {
    path: PathStore;
    board: string[] | null | undefined;
    onSubmit: () => void;
  };

  let { path, board, onSubmit }: Props = $props();

  const word = $derived(path.wordText(board));
  const upper = $derived(word.toUpperCase());
  const hasWord = $derived(word.length > 0);
  const invalid = $derived(word.length > 0 && word.length < 3);
</script>

<div class="word-bar">
  <div class="current-word" class:invalid>
    {#if hasWord}
      {upper}
    {:else}
      <span class="cw-placeholder">
        <span class="cw-hint-desktop">tap, type, or slide</span>
        <span class="cw-hint-touch">tap or slide</span>
      </span>
    {/if}
  </div>
  <button
    type="button"
    class="icon-btn"
    aria-label="Undo last letter"
    hidden={!hasWord}
    onclick={(e) => {
      e.stopPropagation();
      path.pop();
    }}
  >↶</button>
  <button
    type="button"
    class="btn primary"
    hidden={!hasWord}
    onclick={onSubmit}
  >submit</button>
</div>

<!-- Styles shared via global word-bar.css. -->
