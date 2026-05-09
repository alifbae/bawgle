<!--
  One result-screen word pill. Carries its own data-word attribute so
  the Results-level delegated handlers (hover-to-preview on the board,
  Wiktionary tooltip) keep working without per-chip prop plumbing.
-->
<script lang="ts">
  import { scoreWord } from "../../../shared/types.ts";

  type Props = {
    word: string;
    unique?: boolean;
    /** When true the chip renders in its pinned/active state. The
     *  parent sets this for whichever chip matches the currently
     *  previewed word on the board. */
    active?: boolean;
  };

  let { word, unique = false, active = false }: Props = $props();
</script>

<span
  class="chip"
  class:chip-unique={unique}
  class:is-active={active}
  data-word={word}
  role="button"
  tabindex="0"
>
  {#if unique}
    <span class="chip-star" title="only you found this">★</span>
  {/if}
  {word}<sup class="chip-score">+{scoreWord(word)}</sup>
</span>
