<!--
  The current player's found-words list. Latest find shows first and
  gets an underline so players can tell what just landed.
-->
<script lang="ts">
  import type { Player } from "../../../shared/types.ts";
  import { scoreWord } from "../../../shared/types.ts";

  type Props = { me: Player | null | undefined };
  let { me }: Props = $props();

  const words = $derived(me?.words ?? []);
  const reversed = $derived([...words].reverse());
  const latest = $derived(words[words.length - 1]);
</script>

<div class="found-words">
  {#each reversed as w, i (w + "-" + (words.length - 1 - i))}
    <span
      class="fw"
      class:fw-long={w.length >= 6}
      class:fw-latest={i === 0 && w === latest}
    >
      <span class="fw-text">{w}</span>
      <span class="fw-score">+{scoreWord(w)}</span>
    </span>
  {/each}
</div>

<!-- Styles shared via global word-bar.css. -->
