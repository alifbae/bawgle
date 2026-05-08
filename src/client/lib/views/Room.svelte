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

  // Whether the center-slot (between room-header and board) has any
  // content to render this tick. When false the whole slot is
  // omitted — avoids an empty padded <div> that creates visible
  // space between the room header and the lobby tutorial.
  const showWaitingHostStart = $derived(
    $room.state?.phase === "lobby" && !$isHost && !meReady && allReady,
  );
  const showReadyUp = $derived(
    $room.state?.phase === "lobby" && !allReady && !$isHost && !meReady,
  );
  const showTimer = $derived($room.state?.phase === "playing");
  const centerSlotUsed = $derived(
    showWaitingHostStart || showReadyUp || showTimer,
  );

  // Local tick for the force-start progress stripe + countdown label
  // under the host's start button. We read `forceStartReadyAt` off the
  // server snapshot; this tick just drives the rerender cadence.
  let nowMs = $state(Date.now());
  $effect(() => {
    if ($room.state?.forceStartReadyAt === null || $room.state?.forceStartReadyAt === undefined) {
      return; // nothing armed, no ticker needed
    }
    const id = setInterval(() => (nowMs = Date.now()), 250);
    return () => clearInterval(id);
  });

  const forceStartArmedAt = $derived($room.state?.forceStartReadyAt ?? null);
  const forceStartMs = $derived(
    forceStartArmedAt === null ? 0 : Math.max(0, forceStartArmedAt - nowMs),
  );
  // The total wait kept client-side so we can draw the progress bar
  // without piping it through state. Matches FORCE_START_WAIT_MS on
  // the server; changing either without the other breaks the visual.
  const FORCE_START_TOTAL_MS = 15_000;
  const forceStartProgress = $derived(
    forceStartArmedAt === null
      ? 0
      : Math.min(1, 1 - forceStartMs / FORCE_START_TOTAL_MS),
  );
  const canForceStart = $derived(
    forceStartArmedAt !== null && forceStartMs === 0 && !allReady,
  );
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

    {#if centerSlotUsed}
      <div class="center-slot">
        {#if showWaitingHostStart}
          <span class="waiting-host">waiting for host to start the round</span>
        {:else if showReadyUp}
          <span class="waiting-host">ready up to start the round</span>
        {:else if showTimer}
          <Timer endsAt={s.endsAt} />
        {/if}
      </div>
    {/if}

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
          {@const forceArmed = forceStartArmedAt !== null}
          {@const waitingSecs = Math.max(1, Math.ceil(forceStartMs / 1000))}
          {@const label = countingDown
            ? "starting…"
            : allReady
              ? "start round"
              : canForceStart
                ? "start anyway"
                : forceArmed
                  ? `start anyway in ${waitingSecs}s`
                  : "waiting for players"}
          {@const onHostStart = () => {
            // 1. Everyone ready → normal start (green happy path).
            // 2. Not everyone ready, nothing armed → first press
            //    arms the wait window on the server. Idempotent
            //    server-side.
            // 3. Wait window elapsed → force-start.
            if (allReady) {
              send({ t: "start" });
            } else if (canForceStart) {
              send({ t: "start", force: true });
            } else {
              send({ t: "start" });
            }
          }}
          {@const isDisabled =
            countingDown ||
            // Armed but still waiting the 15s out: button is
            // showing the countdown, can't be clicked again.
            (forceArmed && !canForceStart) ||
            // Edge case: no non-host players yet, host hasn't
            // readied anyone. allReady is true (vacuously), so
            // this branch is unreachable — kept for clarity.
            false}
          <button
            type="button"
            class="btn primary start-round-btn"
            class:ready={allReady && !countingDown}
            class:force-wait={forceArmed && !canForceStart}
            class:force-ready={canForceStart}
            disabled={isDisabled}
            title={allReady
              ? ""
              : canForceStart
                ? "start the round without waiting"
                : forceArmed
                  ? "starting anyway soon — click to override"
                  : "click once to wait for players"}
            onclick={onHostStart}
            style={forceArmed
              ? `--force-progress: ${(forceStartProgress * 100).toFixed(1)}%`
              : undefined}
          >{label}</button>
        {/if}
      </div>
      {#if countingDown}
        <!-- Pre-round countdown lives under the action buttons so the
             host sees it directly below "starting…" and every player
             sees it under their ready button. Leaves the center slot
             free for status prose. -->
        <div class="pre-round-countdown">
          <Countdown startsAt={s.startsAt ?? 0} />
        </div>
      {/if}
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
