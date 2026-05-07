<!--
  Full results screen body: scoreboard per player, missed words
  collapsible, board preview with chip-hover highlighting, Wiktionary
  tooltip on any chip. Matches the live results and shared /result
  page so rendering stays consistent.

  Chip interactions:
    - hover (desktop) → preview path on board (transient)
    - click/tap → pin path (persistent until another pin or outside-tap)
    - definition tooltip → 250ms hover open, click toggles
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
  let hoverWord: string | null = $state(null);
  let pinnedWord: string | null = $state(null);
  const highlightWord = $derived(hoverWord ?? pinnedWord);

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

  // Chip hover/click → highlight path on the preview board.
  function onRootPointerOver(e: PointerEvent): void {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-word]",
    );
    if (chip) hoverWord = chip.getAttribute("data-word");
  }
  function onRootPointerOut(e: PointerEvent): void {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-word]",
    );
    if (!chip) return;
    const next = e.relatedTarget instanceof Element
      ? e.relatedTarget.closest<HTMLElement>("[data-word]")
      : null;
    if (next && next === chip) return;
    hoverWord = null;
  }
  function onRootClick(e: MouseEvent): void {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-word]",
    );
    if (chip) {
      pinnedWord = chip.getAttribute("data-word");
      return;
    }
    // Click somewhere non-chip — clear pin (but not hover).
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
  onpointerover={onRootPointerOver}
  onpointerout={onRootPointerOut}
  onclick={onRootClick}
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
            <ResultChip {word} unique={isUnique(word)} />
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
            <ResultChip {word} />
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
