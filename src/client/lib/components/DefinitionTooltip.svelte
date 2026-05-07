<!--
  Floating Wiktionary definition tooltip for result-screen chips.
  Attaches delegated pointer/keyboard listeners on its root so every
  `.chip[data-word]` inside triggers a lookup without per-chip wiring.
  Caches responses in-memory so repeated taps don't re-fetch.
-->
<script lang="ts">
  import { onMount } from "svelte";

  interface DefinitionResponse {
    word: string;
    lemma?: string | null;
    defs: { pos: string; def: string }[];
  }

  type Props = {
    rootEl: HTMLElement | null;
  };

  let { rootEl }: Props = $props();

  const cache = new Map<string, DefinitionResponse>();
  let tooltipEl: HTMLDivElement | null = $state(null);
  let activeChip: HTMLElement | null = null;
  type TipState = "hidden" | "loading" | "shown" | "empty";
  let status: TipState = $state("hidden");
  let data: DefinitionResponse | null = $state(null);
  let currentWord: string = $state("");

  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (!rootEl) return;

    const onClick = (e: MouseEvent) => {
      const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        ".chip[data-word]",
      );
      if (!chip) return;
      e.stopPropagation();
      if (activeChip === chip) {
        hide();
      } else {
        showFor(chip);
      }
    };

    const onOver = (e: MouseEvent) => {
      const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        ".chip[data-word]",
      );
      if (!chip) return;
      clearHoverTimer();
      hoverTimer = setTimeout(() => showFor(chip), 250);
    };

    const onOut = (e: MouseEvent) => {
      const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        ".chip[data-word]",
      );
      if (!chip) return;
      clearHoverTimer();
      if (!activeChip) return;
      if (activeChip === chip) {
        setTimeout(() => {
          if (activeChip === chip) hide();
        }, 120);
      }
    };

    const onOutsideClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".chip[data-word]")) return;
      if (tooltipEl && tooltipEl.contains(t)) return;
      hide();
    };

    const onScroll = () => hide();

    rootEl.addEventListener("click", onClick);
    rootEl.addEventListener("mouseover", onOver);
    rootEl.addEventListener("mouseout", onOut);
    document.addEventListener("click", onOutsideClick);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      rootEl.removeEventListener("click", onClick);
      rootEl.removeEventListener("mouseover", onOver);
      rootEl.removeEventListener("mouseout", onOut);
      document.removeEventListener("click", onOutsideClick);
      window.removeEventListener("scroll", onScroll);
      clearHoverTimer();
    };
  });

  function clearHoverTimer(): void {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  function hide(): void {
    activeChip = null;
    status = "hidden";
    data = null;
  }

  async function showFor(chip: HTMLElement): Promise<void> {
    const word = chip.dataset.word;
    if (!word) return;
    if (activeChip === chip) return;
    activeChip = chip;
    currentWord = word;
    status = "loading";
    data = null;
    await positionTooltip(chip);

    const cached = cache.get(word);
    if (cached) {
      data = cached;
      status = cached.defs.length ? "shown" : "empty";
      await positionTooltip(chip);
      return;
    }

    try {
      const base = location.pathname.replace(/\/[^/]*$/, "/");
      const res = await fetch(`${base}api/define/${encodeURIComponent(word)}`);
      const body = (await res.json()) as DefinitionResponse;
      cache.set(word, body);
      if (activeChip !== chip) return;
      data = body;
      status = body.defs.length ? "shown" : "empty";
      await positionTooltip(chip);
    } catch {
      if (activeChip !== chip) return;
      status = "empty";
    }
  }

  async function positionTooltip(chip: HTMLElement): Promise<void> {
    if (!tooltipEl) {
      // First render pass — tooltip element hasn't mounted yet.
      requestAnimationFrame(() => positionTooltip(chip));
      return;
    }
    const r = chip.getBoundingClientRect();
    tooltipEl.style.maxWidth = "22rem";
    tooltipEl.style.left = "0px";
    tooltipEl.style.top = "0px";
    const tr = tooltipEl.getBoundingClientRect();
    const margin = 8;
    const viewportW = window.innerWidth;
    const chipCenter = r.left + r.width / 2;

    const wouldOverflowRight = chipCenter + tr.width / 2 > viewportW - margin;
    const roomLeft = r.right - margin;
    let left: number;
    if (wouldOverflowRight && roomLeft > 0) {
      left = r.right - tr.width;
      if (left < margin) {
        tooltipEl.style.maxWidth = `${r.right - margin}px`;
        const tr2 = tooltipEl.getBoundingClientRect();
        left = r.right - tr2.width;
      }
    } else {
      left = Math.max(
        margin,
        Math.min(viewportW - tr.width - margin, chipCenter - tr.width / 2),
      );
    }

    const tr2 = tooltipEl.getBoundingClientRect();
    const spaceAbove = r.top;
    const spaceBelow = window.innerHeight - r.bottom;

    const previewBottom = (() => {
      const preview = document.querySelector<HTMLElement>(".results-board-wrap");
      if (!preview || preview.hidden) return 0;
      return preview.getBoundingClientRect().bottom;
    })();
    const wouldOverlapPreview =
      previewBottom > 0 && r.top - tr2.height - 10 < previewBottom + 4;

    const placeAbove =
      !wouldOverlapPreview &&
      (spaceAbove >= tr2.height + 12 || spaceAbove > spaceBelow);
    const top = placeAbove ? r.top - tr2.height - 10 : r.bottom + 10;

    tooltipEl.style.left = `${left + window.scrollX}px`;
    tooltipEl.style.top = `${top + window.scrollY}px`;
    tooltipEl.classList.toggle("above", placeAbove);
    tooltipEl.classList.toggle("below", !placeAbove);
  }

  const shown = $derived(status !== "hidden");
</script>

<div
  bind:this={tooltipEl}
  class="def-tooltip"
  class:visible={shown}
  role="tooltip"
  hidden={!shown}
>
  {#if status === "loading"}
    <div class="def-word">{currentWord.toUpperCase()}</div>
    <div class="def-loading muted small">…</div>
  {:else if status === "empty" || (status === "shown" && data && data.defs.length === 0)}
    <div class="def-word">{currentWord.toUpperCase()}</div>
    <div class="def-empty muted small">no definition available</div>
  {:else if status === "shown" && data}
    <div class="def-word">
      {data.word.toUpperCase()}
      {#if data.lemma}
        <span class="def-lemma muted small">(from {data.lemma})</span>
      {/if}
    </div>
    {#each data.defs.slice(0, 2) as sense, i (i)}
      <div class="def-sense">
        <span class="def-pos">{sense.pos}</span>
        <span class="def-text">{sense.def}</span>
      </div>
    {/each}
  {/if}
</div>

<!-- Styles shared via global tooltip.css. -->
