<!--
  Small list of joinable rooms shown under the Join tab.
  Polls /api/rooms/public every 5s so new rooms surface without a
  refresh; stops polling the moment the user clicks a row (the app
  immediately transitions out of the lobby).

  Visual: one line per room — monospace code pill, a coloured phase
  dot (green = playing, amber = lobby), player count. Clicking a row
  fills in the code for the user; they still hit "join room" so name
  validation and submit flow stay in one place.
-->
<script lang="ts">
  import { onMount } from "svelte";

  type PublicRoom = {
    code: string;
    phase: "lobby" | "playing";
    size: 4 | 5 | 6;
    playerCount: number;
    endsAt: number | null;
    hostName: string | null;
  };

  type Props = {
    onPick: (code: string) => void;
    /** Called when the user clicks the "host one" nudge in the empty
     *  state. The parent knows how to switch tabs; this component
     *  just announces the intent. */
    onHostRequest?: () => void;
  };

  let { onPick, onHostRequest }: Props = $props();

  let rooms: PublicRoom[] = $state([]);
  let loading = $state(true);
  let failed = $state(false);
  // Ticks once per second so the "time left" label in playing rooms
  // counts down live instead of waiting for the next /api/rooms/public
  // poll. Kept local so the list-level fetch cadence stays at 5s.
  let now = $state(Date.now());
  // Bumps once per successful load so the header can briefly flash a
  // "just refreshed" state if we ever want it. Keeps the manual-
  // refresh click from running twice in a row before a response lands.
  let refreshing = $state(false);

  function formatRemaining(endsAt: number | null): string | null {
    if (!endsAt) return null;
    const remain = Math.max(0, endsAt - now);
    if (remain <= 0) return "0:00";
    const s = Math.floor(remain / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  async function load(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const base = location.pathname.replace(/\/[^/]*$/, "/");
      const res = await fetch(`${base}api/rooms/public`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { rooms: PublicRoom[] };
      rooms = body.rooms;
      failed = false;
    } catch {
      failed = true;
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  onMount(() => {
    void load();
    // 5s cadence is enough for "oh my friend just started hosting"
    // to surface within a coffee-sip, without hammering the server.
    const pollId = setInterval(load, 5000);
    const tickId = setInterval(() => (now = Date.now()), 1000);
    return () => {
      clearInterval(pollId);
      clearInterval(tickId);
    };
  });
</script>

<div class="public-rooms">
  <div class="public-rooms-head">
    <h3 class="public-rooms-title">
      <span class="public-rooms-dot" aria-hidden="true"></span>
      live
      {#if rooms.length > 0}
        <span class="public-rooms-count">{rooms.length}</span>
      {/if}
    </h3>
    <button
      type="button"
      class="public-rooms-refresh"
      class:is-spinning={refreshing}
      aria-label="Refresh live rooms"
      title="Refresh"
      onclick={() => void load()}
      disabled={refreshing}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-3.5-7.1" />
        <polyline points="21 4 21 10 15 10" />
      </svg>
    </button>
  </div>

  {#if loading}
    <div class="public-rooms-empty muted small">…</div>
  {:else if failed}
    <div class="public-rooms-empty muted small">couldn't load rooms</div>
  {:else if rooms.length === 0}
    <div class="public-rooms-empty muted small">
      no rooms yet —
      {#if onHostRequest}
        <button
          type="button"
          class="public-rooms-host-link"
          onclick={() => onHostRequest?.()}
        >host one</button>
      {:else}
        host one
      {/if}
    </div>
  {:else}
    <ul class="public-rooms-list">
      {#each rooms as r (r.code)}
        <li>
          <button
            type="button"
            class="public-room"
            onclick={() => onPick(r.code)}
            title={r.phase === "playing" ? "in a round" : "in lobby"}
          >
            <span
              class="public-room-dot"
              class:playing={r.phase === "playing"}
              class:lobby={r.phase === "lobby"}
              aria-hidden="true"
            ></span>
            <span class="public-room-code">{r.code}</span>
            {#if r.hostName}
              <span class="public-room-host muted small" title="host">
                {r.hostName}
              </span>
            {/if}
            <span class="public-room-meta muted small">
              {#if r.phase === "playing"}
                {@const left = formatRemaining(r.endsAt)}
                {#if left}
                  <span class="public-room-timer" title="time left in round">{left}</span>
                  <span class="public-room-sep">·</span>
                {/if}
              {/if}
              {r.size}×{r.size} · {r.playerCount}
              {r.playerCount === 1 ? "player" : "players"}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .public-rooms {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }

  .public-rooms-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px dashed var(--c-border);
  }

  .public-rooms-title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--c-fg);
  }

  /* Tiny pulsing dot — signals that the list is live. No dot in
     classic terminal fashion: colour + pulse sells the idea. */
  .public-rooms-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--c-good);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--c-good) 55%, transparent);
    animation: public-rooms-dot 1.8s ease-in-out infinite;
  }

  @keyframes public-rooms-dot {
    0%, 100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--c-good) 55%, transparent);
    }
    50% {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--c-good) 0%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .public-rooms-dot {
      animation: none;
    }
  }

  .public-rooms-count {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--c-muted);
    padding: 0.08rem 0.45rem;
    border: 1px solid var(--c-border);
    border-radius: 999px;
    background: var(--c-bg);
  }

  .public-rooms-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    padding: 0;
    background: transparent;
    color: var(--c-muted);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  .public-rooms-refresh:hover,
  .public-rooms-refresh:focus-visible {
    color: var(--c-fg);
    border-color: var(--c-fg);
    outline: none;
  }

  .public-rooms-refresh:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  .public-rooms-refresh svg {
    display: block;
    transition: transform 200ms ease;
  }

  .public-rooms-refresh.is-spinning svg {
    animation: public-rooms-spin 700ms linear infinite;
  }

  @keyframes public-rooms-spin {
    to { transform: rotate(360deg); }
  }

  .public-rooms-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .public-rooms-empty {
    padding: 0.4rem 0.1rem;
  }

  /* Inline "host one" button that appears in the empty state. Styled
     like a text link so it blends into the muted prose, but
     keyboard-focusable and colour-flips on hover. */
  .public-rooms-host-link {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    font: inherit;
    color: var(--c-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .public-rooms-host-link:hover,
  .public-rooms-host-link:focus-visible {
    color: var(--c-fg);
    outline: none;
  }

  .public-room {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.7rem;
    background: var(--c-bg);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    font: inherit;
    text-align: left;
    cursor: pointer;
    color: var(--c-fg);
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }

  .public-room:hover,
  .public-room:focus-visible {
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) 8%, var(--c-bg));
    outline: none;
  }

  .public-room-dot {
    flex-shrink: 0;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--c-muted);
  }

  .public-room-dot.playing {
    background: var(--c-good);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-good) 25%, transparent);
  }

  .public-room-dot.lobby {
    background: var(--c-warn);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-warn) 25%, transparent);
  }

  .public-room-code {
    font-family: var(--font-mono);
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.2em;
    color: var(--c-fg);
  }

  .public-room-host {
    font-family: var(--font-mono);
    color: var(--c-muted);
    letter-spacing: 0.05em;
    /* Between the code pill and the meta, but always subordinate —
       the host's 4-char name is a social cue, not the primary ID. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 6rem;
  }

  .public-room-host::before {
    content: "by ";
    opacity: 0.7;
    font-family: var(--font-sans);
    letter-spacing: 0;
  }

  .public-room-meta {
    margin-left: auto;
    font-family: var(--font-sans);
    white-space: nowrap;
  }

  .public-room-timer {
    font-family: var(--font-mono);
    color: var(--c-accent);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    margin-right: 0.15rem;
  }

  .public-room-sep {
    margin: 0 0.2rem;
    opacity: 0.6;
  }
</style>
