<!--
  Full results screen body: scoreboard per player, missed words
  collapsible, board preview with chip-click highlighting, Wiktionary
  tooltip on any chip. Matches the live results and shared /result
  page so rendering stays consistent.

  Chip interactions:
    - click/tap → pin path on preview board (persistent until
      another pin or outside-tap)
    - definition tooltip → 250ms hover open, click toggles

  Hover-to-preview was removed after the sub-element hops on the pill
  (star / text / score sup) made the preview blink; click-to-pin works
  the same on desktop and touch and is the single source of truth for
  which word the preview is showing.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { RoomState } from "../../../shared/types.ts";
  import ResultChip from "./ResultChip.svelte";
  import ResultsPreview from "./ResultsPreview.svelte";
  import DefinitionTooltip from "./DefinitionTooltip.svelte";

  type Props = {
    roomState: RoomState;
    meId: string | null;
  };

  let { roomState, meId }: Props = $props();

  let rootEl: HTMLDivElement | null = $state(null);
  let missedOpen = $state(false);
  let pinnedWord: string | null = $state(null);
  const highlightWord = $derived(pinnedWord);

  const sorted = $derived(
    [...roomState.players].sort((a, b) => b.score - a.score),
  );
  const topScore = $derived(sorted[0]?.score ?? 0);

  // Word-frequency map across players: star chips found by only one player.
  const wordCounts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const p of roomState.players) {
      for (const w of p.words) {
        const key = w.toLowerCase();
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
    return m;
  });

  const possible = $derived(roomState.possibleWords ?? []);

  const missed = $derived.by(() => {
    const found = new Set<string>();
    for (const p of roomState.players) for (const w of p.words) found.add(w);
    return possible
      .filter((w) => !found.has(w))
      .sort((a, b) => b.length - a.length || a.localeCompare(b));
  });

  function sortWords(words: string[]): string[] {
    return [...words].sort(
      (a, b) => b.length - a.length || a.localeCompare(b),
    );
  }

  function isUnique(word: string): boolean {
    return (wordCounts.get(word.toLowerCase()) ?? 0) === 1;
  }

  // Chip click/tap → pin the path highlight. pointerdown (not click)
  // so the board lights up the instant the finger lands and so Safari
  // doesn't swallow the interaction on micro-movement during a tap.
  function onRootPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement | null;
    const chip = target?.closest<HTMLElement>("[data-word]");
    if (chip) {
      pinnedWord = chip.getAttribute("data-word");
      return;
    }
    // Tapping the preview board itself (to inspect the highlighted
    // path) shouldn't clear the pin — only tapping a non-interactive
    // area inside the results region does.
    if (target?.closest(".results-board-wrap")) return;
    pinnedWord = null;
  }

  // Outside-click dismisses the pin too.
  onMount(() => {
    const onOutside = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (rootEl && rootEl.contains(e.target)) return;
      pinnedWord = null;
    };
    document.addEventListener("click", onOutside);
    return () => document.removeEventListener("click", onOutside);
  });

  // Pick board size from the stored board length so the same component
  // works for 4×4, 5×5, and 6×6 shared round payloads.
  const previewSize = $derived.by(() => {
    const n = roomState.board?.length ?? 0;
    const s = Math.round(Math.sqrt(n));
    return s === 4 || s === 5 || s === 6 ? (s as 4 | 5 | 6) : 4;
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={rootEl}
  id="results-body"
  role="region"
  aria-label="Results"
  onpointerdown={onRootPointerDown}
  onkeydown={(e) => {
    if (e.key === "Escape") pinnedWord = null;
  }}
>
  {#if roomState.board && roomState.board.length > 0}
    <ResultsPreview
      board={roomState.board}
      size={previewSize}
      {highlightWord}
    />
  {/if}

  {#each sorted as p (p.id)}
    {@const isWinner = p.score === topScore && topScore > 0}
    {@const isMe = !!meId && p.id === meId}
    <div
      class="result-row"
      class:winner={isWinner}
      class:me={isMe}
    >
      <div class="rhead">
        <span class="pname">
          {#if isWinner}
            <span class="winner-crown" title="winner">♛</span>
          {/if}
          {p.name}
          {#if isMe}
            <span class="me-mark">(you)</span>
          {/if}
        </span>
        <span class="pscore">{p.score}</span>
      </div>
      <div class="words">
        {#if p.words.length === 0}
          <span class="chip" style="opacity:.5">no words</span>
        {:else}
          {#each sortWords(p.words) as word (word)}
            <ResultChip
              {word}
              unique={isUnique(word)}
              active={pinnedWord === word}
            />
          {/each}
        {/if}
      </div>
    </div>
  {/each}

  {#if possible.length > 0}
    <div class="result-row missed" class:collapsed={!missedOpen && missed.length > 12}>
      <div class="rhead">
        <span class="pname">missed</span>
        <span class="pscore">{missed.length} / {possible.length}</span>
      </div>
      <div class="words missed-words">
        {#if missed.length === 0}
          <span class="chip" style="opacity:.5">everyone was thorough</span>
        {:else}
          {#each missed as word (word)}
            <ResultChip {word} active={pinnedWord === word} />
          {/each}
        {/if}
      </div>
      {#if missed.length > 12}
        <button
          type="button"
          class="missed-toggle"
          aria-expanded={missedOpen ? "true" : "false"}
          onclick={() => (missedOpen = !missedOpen)}
        >
          <span class="missed-toggle-label">{missedOpen ? "show less" : "show all"}</span>
          <span class="missed-toggle-icon" aria-hidden="true">▾</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<DefinitionTooltip rootEl={rootEl} />

<!-- Styles shared via global results.css. -->
