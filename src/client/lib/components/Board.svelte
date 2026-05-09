<!--
  Interactive (and non-interactive) Boggle board. A grid of dice with
  an SVG trail overlay linking the cells along the current word path.
  Highlights selected / last / adjacent tiles via classes.

  Used in two modes:
    - interactive: pointer/keyboard input manipulates the path (Play)
    - readOnly: board renders but input listeners are inert; callers
      drive the path via props (Results preview)

  Trail redraw is bound to `path`, size, and window resize. The
  ResizeObserver on the board element handles container-size changes
  (phone rotation, viewport shrink).
-->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { PathStore } from "../stores/path.ts";
  import { neighbors, setBoardSize } from "../stores/adjacency.ts";

  const SVG_NS = "http://www.w3.org/2000/svg";

  type Props = {
    board: string[] | null | undefined;
    size: 4 | 5 | 6;
    path: PathStore;
    readOnly?: boolean;
    pressToken?: number; // bump to pulse the most-recent tile
  };

  let { board, size, path, readOnly = false, pressToken = 0 }: Props = $props();

  let boardEl: HTMLDivElement | null = $state(null);
  let trailEl: SVGSVGElement | null = $state(null);

  $effect(() => {
    // Sync the adjacency helper's global board size whenever the
    // prop changes. The path store depends on it to validate moves.
    setBoardSize(size);
  });

  // Re-paint the trail when any of these change.
  $effect(() => {
    // Access reactive inputs so Svelte tracks them:
    void $path;
    void board;
    void size;
    tick().then(() => drawTrail());
  });

  // Pulse the most-recent tile when `pressToken` bumps. Separate from
  // the path change so a full redraw doesn't reset the animation.
  let prevToken = 0;
  $effect(() => {
    if (pressToken === prevToken) return;
    prevToken = pressToken;
    const last = $path[$path.length - 1];
    if (last !== undefined) pulsePress(last);
  });

  onMount(() => {
    const onResize = () => drawTrail();
    window.addEventListener("resize", onResize);
    let ro: ResizeObserver | null = null;
    if (boardEl && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => drawTrail());
      ro.observe(boardEl);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  });

  function pulsePress(index: number): void {
    if (!boardEl) return;
    const el = boardEl.querySelector<HTMLElement>(
      `.die[data-index="${index}"]`,
    );
    if (!el) return;
    el.classList.remove("pressed");
    void el.offsetWidth; // force reflow
    el.classList.add("pressed");
    setTimeout(() => el.classList.remove("pressed"), 130);
  }

  function capCenter(index: number): { x: number; y: number } | null {
    if (!boardEl) return null;
    const el = boardEl.querySelector<HTMLElement>(
      `.die[data-index="${index}"]`,
    );
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();
    return {
      x: rect.left - boardRect.left + rect.width / 2,
      y: rect.top - boardRect.top + rect.height / 2,
    };
  }

  function drawTrail(): void {
    if (!trailEl || !boardEl) return;
    // The trail SVG is bound with bind:this but its children are
    // managed imperatively so we don't churn a reactive diff on every
    // pointer move. Svelte won't rerender them — this is intentional.
    // eslint-disable-next-line svelte/no-dom-manipulating
    trailEl.innerHTML = "";
    const indices = $path;
    if (indices.length < 2) return;
    const rect = boardEl.getBoundingClientRect();
    trailEl.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    trailEl.setAttribute("preserveAspectRatio", "none");
    const points = indices
      .map((i) => capCenter(i))
      .filter((p): p is { x: number; y: number } => p !== null);
    if (points.length < 2) return;
    const d = points
      .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
      .join(" ");
    const line = document.createElementNS(SVG_NS, "path");
    line.setAttribute("class", "trail-line");
    line.setAttribute("d", d);
    // eslint-disable-next-line svelte/no-dom-manipulating
    trailEl.appendChild(line);
  }

  // Cell decorations derived from the path.
  const selSet = $derived(new Set($path));
  const last = $derived($path[$path.length - 1]);
  // First cell of the path. Live play emphasizes the last cell (where
  // the word ends, i.e. where the user's finger is). The results
  // preview emphasizes the first cell instead so a click on a pill
  // shows "here's where this word starts"; see the `.read-only`
  // branch in board.css.
  const first = $derived($path[0]);
  const adjSet = $derived(
    last !== undefined
      ? new Set(neighbors(last).filter((i) => !selSet.has(i)))
      : new Set<number>(),
  );

  const total = $derived(size * size);
  const cells = $derived(
    board
      ? board.map((face, i) => ({
          index: i,
          label: face === "Qu" ? "Qu" : face.toUpperCase(),
          placeholder: false,
        }))
      : Array.from({ length: total }, (_, i) => ({
          index: i,
          label: "·",
          placeholder: true,
        })),
  );

  /**
   * Pointer helpers — exposed via the component's bound element so
   * the input handler in Play.svelte can use hit-testing for drag
   * gestures. Attached by parent through the exported API below.
   */
  export function findCapUnderPoint(clientX: number, clientY: number): number {
    if (!boardEl) return -1;
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return -1;
    const die = el.closest<HTMLButtonElement>(".die");
    if (!die || !boardEl.contains(die) || die.disabled) return -1;
    return Number(die.dataset.index);
  }

  export function findCapNearPoint(
    clientX: number,
    clientY: number,
    tolerance = 0.55,
  ): number {
    if (!boardEl) return -1;
    const dice = boardEl.querySelectorAll<HTMLButtonElement>(
      ".die:not(:disabled)",
    );
    let bestIdx = -1;
    let bestDistSq = Infinity;
    let tileSize = 0;
    for (const die of dice) {
      const rect = die.getBoundingClientRect();
      if (!tileSize) tileSize = Math.max(rect.width, rect.height);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIdx = Number(die.dataset.index);
      }
    }
    if (bestIdx === -1) return -1;
    const maxDist = tileSize * tolerance;
    if (bestDistSq > maxDist * maxDist) return -1;
    return bestIdx;
  }

  export function getBoardEl(): HTMLDivElement | null {
    return boardEl;
  }
</script>

<div
  bind:this={boardEl}
  class="board"
  class:read-only={readOnly}
  style="--board-size: {size};"
>
  <svg
    bind:this={trailEl}
    class="board-trail"
    aria-hidden="true"
  ></svg>
  {#each cells as cell (cell.index)}
    <button
      type="button"
      class="die"
      class:placeholder={cell.placeholder}
      class:selected={selSet.has(cell.index)}
      class:last={cell.index === last}
      class:first={cell.index === first}
      class:adjacent={adjSet.has(cell.index)}
      data-index={cell.index}
      aria-label={cell.placeholder ? "empty tile" : `letter ${cell.label}`}
      disabled={cell.placeholder || readOnly}
    >
      <span class="cap-base"></span>
      <span class="cap-top">
        <span class="cap-label">{cell.label}</span>
      </span>
    </button>
  {/each}
</div>

<!-- Board styles are global (board.css) — shared between play + preview. -->
