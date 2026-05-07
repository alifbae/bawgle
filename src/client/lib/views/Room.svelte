<!--
  Unified room view: renders lobby / playing / results off the shared
  RoomState. All three sub-phases share a topbar and the player pills;
  only the middle area differs. Input wiring (pointer + keyboard) is
  attached only in the playing phase.
-->
<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { isHost, room } from "../stores/room.ts";
  import { createPathStore } from "../stores/path.ts";
  import { attachInput } from "../util/input.ts";
  import { send } from "../util/net.ts";
  import { flashFeedback } from "../stores/feedback.ts";
  import { copyInviteLink, shareRound } from "../util/share.ts";

  import Board from "../components/Board.svelte";
  import Countdown from "../components/Countdown.svelte";
  import FoundWords from "../components/FoundWords.svelte";
  import PlayAgainButton from "../components/PlayAgainButton.svelte";
  import PlayerList from "../components/PlayerList.svelte";
  import Results from "../components/Results.svelte";
  import Settings from "../components/Settings.svelte";
  import Timer from "../components/Timer.svelte";
  import Tutorial from "../components/Tutorial.svelte";
  import WordBar from "../components/WordBar.svelte";

  const path = createPathStore();

  let boardRef: Board | null = $state(null);
  let wordBarEl: HTMLElement | null = $state(null);
  let pressToken = $state(0);
  let detachInput: (() => void) | null = null;

  // Post-round lockout for play-again. Parent bumps armedAt when first
  // landing in results; child PlayAgainButton derives the remaining
  // time from it. Re-arms whenever results phase is re-entered.
  let playAgainArmedAt = $state<number | null>(null);

  // Mirror the room code into the URL so refreshes auto-reconnect.
  $effect(() => {
    const code = $room.state?.code;
    if (!code) return;
    const url = new URL(location.href);
    if (url.searchParams.get("room") === code) return;
    url.searchParams.set("room", code);
    history.replaceState(null, "", url.toString());
  });

  // Wire/unwire input handling as we enter/leave the playing phase.
  $effect(() => {
    const phase = $room.state?.phase;
    if (phase === "playing") {
      // Defer to next tick so the board element is mounted.
      queueMicrotask(() => {
        const boardEl = boardRef?.getBoardEl();
        if (!boardEl) return;
        detachInput?.();
        detachInput = attachInput({
          boardEl,
          wordBarEl,
          path,
          onSubmit: submitCurrentWord,
          getBoard: () => untrack(() => $room.state?.board),
          getPhase: () => untrack(() => $room.state?.phase),
          onPress: (idx) => {
            pressToken += 1;
            // Synchronously so the Board effect for pressToken sees
            // this exact tile. pressToken is already reactive.
            void idx;
          },
          findCapUnderPoint: (x, y) => boardRef?.findCapUnderPoint(x, y) ?? -1,
          findCapNearPoint: (x, y, t) =>
            boardRef?.findCapNearPoint(x, y, t) ?? -1,
        });
      });
    } else {
      detachInput?.();
      detachInput = null;
      // Clear the currently-being-traced word whenever we leave play.
      path.clear();
    }
  });

  // Arm the play-again lockout whenever we FIRST enter results.
  // Disarm it when we leave so a fresh round gets a fresh arm.
  $effect(() => {
    const phase = $room.state?.phase ?? null;
    const prev = $room.prevPhase;
    if (phase === "results" && prev !== "results") {
      playAgainArmedAt = Date.now();
    } else if (phase !== "results" && prev === "results") {
      playAgainArmedAt = null;
    }
  });

  onDestroy(() => {
    detachInput?.();
  });

  function submitCurrentWord(): void {
    const word = path.wordText($room.state?.board);
    if (word.length >= 3) {
      send({ t: "word", word });
    } else if (word.length > 0) {
      flashFeedback("too short", "bad");
    }
    path.clear();
  }

  function onReadyClick(): void {
    const me = $room.state?.players.find((p) => p.id === $room.meId);
    send({ t: "ready", ready: !me?.ready });
  }

  // ─── Lobby derived state ─────────────────────────────────────
  const me = $derived(
    $room.state?.players.find((p) => p.id === $room.meId) ?? null,
  );
  const meReady = $derived(!!me?.ready);
  const connected = $derived(
    $room.state ? $room.state.players.filter((p) => p.connected) : [],
  );
  const nonHostConnected = $derived(
    $room.state
      ? connected.filter((p) => p.id !== $room.state!.hostId)
      : [],
  );
  const allReady = $derived(
    nonHostConnected.length === 0 || nonHostConnected.every((p) => p.ready),
  );
  const countingDown = $derived($room.state?.startsAt !== null && $room.state?.startsAt !== undefined);
</script>

{#if $room.state}
  {@const s = $room.state}
  <section id="room" class="stack">
    <PlayerList state={s} meId={$room.meId} />

    {#if s.phase === "lobby" && $isHost}
      <div class="room-header" id="room-header">
        <div class="room-code" id="room-code-display">{s.code}</div>
        <button
          class="btn primary invite-btn"
          aria-label="Share invite link"
          onclick={copyInviteLink}
        >
          <svg
            class="invite-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span class="invite-label">share</span>
        </button>
      </div>
    {/if}

    <div class="center-slot">
      {#if countingDown}
        <Countdown startsAt={s.startsAt ?? 0} />
      {:else if s.phase === "lobby" && !$isHost && !meReady && allReady}
        <span class="waiting-host">waiting for host to start the round</span>
      {:else if s.phase === "lobby" && !allReady && !$isHost && !meReady}
        <span class="waiting-host">ready up to start the round</span>
      {:else if s.phase === "playing"}
        <Timer endsAt={s.endsAt} />
      {/if}
    </div>

    {#if s.phase === "lobby"}
      <Tutorial variant="room" />
    {/if}

    {#if s.phase === "playing" || s.phase === "results"}
      {#if s.phase === "playing"}
        <div class="board-wrap">
          <Board
            bind:this={boardRef}
            board={s.board}
            size={s.settings.size}
            {path}
            {pressToken}
          />
        </div>
      {/if}
    {/if}

    {#if s.phase === "lobby" && $isHost}
      <Settings
        settings={s.settings}
        onChange={(partial) => send({ t: "settings", settings: partial })}
      />
    {/if}

    {#if s.phase === "lobby"}
      <div class="start-slot">
        {#if !$isHost && me}
          <button
            type="button"
            class="btn primary ready-btn"
            class:is-ready={meReady}
            disabled={countingDown}
            onclick={onReadyClick}
          >{meReady ? "not ready" : "i'm ready"}</button>
        {/if}
        {#if $isHost}
          {@const label = countingDown
            ? "starting…"
            : allReady
              ? "start round"
              : "waiting for players"}
          <button
            type="button"
            class="btn primary start-round-btn"
            class:ready={allReady && !countingDown}
            disabled={!allReady || countingDown}
            title={allReady ? "" : "all players must be ready"}
            onclick={() => send({ t: "start" })}
          >{label}</button>
        {/if}
      </div>
    {/if}

    {#if s.phase === "playing"}
      <div bind:this={wordBarEl}>
        <WordBar {path} board={s.board} onSubmit={submitCurrentWord} />
      </div>
      <div class="possible-words">
        <span class="muted small">possible words:</span>
        <span class="pw-count">{s.possibleCount ?? "–"}</span>
      </div>
      <div class="your-words">
        <span class="muted small">your words:</span>
        <span class="pw-count">{me?.words.length ?? 0}</span>
      </div>
      <FoundWords {me} />
    {/if}

    {#if s.phase === "results"}
      <h2 class="results-title">round over</h2>
      <Results roomState={s} meId={$room.meId} />
      <div class="results-actions">
        {#if s.lastRoundId}
          <button
            type="button"
            class="btn share-btn"
            onclick={() => shareRound(s)}
          >share results</button>
        {/if}
        <PlayAgainButton
          visible={$isHost}
          armedAt={playAgainArmedAt}
          onClick={() => send({ t: "lobby" })}
        />
      </div>
    {/if}
  </section>
{/if}
