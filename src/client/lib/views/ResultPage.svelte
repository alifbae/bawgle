<!--
  Shareable, read-only results page.
  Mounted when the SPA is loaded at `/result?round=N` or
  `/result?room=XYZ`. Renders the same Results component as the live
  screen so pills, scores, missed-words lists, and the board preview
  all look identical.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import Results from "../components/Results.svelte";
  import type { RoomState } from "../../../shared/types.ts";

  type RoomStatus = "active" | "inactive" | "closed";

  interface StoredRound {
    id: number;
    roomCode: string;
    startedAt: number;
    endedAt: number;
    board: string[];
    settings: RoomState["settings"];
    hostId: string | null;
    players: Array<{ id: string; name: string; score: number; words: string[] }>;
    possibleWords: string[];
  }

  type ApiResponse =
    | { status: "ok"; round: StoredRound; roomStatus: RoomStatus }
    | { status: "in_progress"; phase: string }
    | { status: "not_found" };

  let state = $state<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ok"; round: StoredRound; roomStatus: RoomStatus }
  >({ kind: "loading" });

  onMount(() => {
    document.body.classList.add("is-result-page");
    void load();
    return () => {
      document.body.classList.remove("is-result-page");
    };
  });

  async function load(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const roundIdRaw = params.get("round");
    const roundId = roundIdRaw ? Number(roundIdRaw) : NaN;
    const rawCode = (params.get("room") || "").toUpperCase();
    const code = rawCode.replace(/[^A-Z0-9]/g, "").slice(0, 4);

    let endpoint: string | null = null;
    if (Number.isFinite(roundId) && roundId > 0) {
      endpoint = `./api/round/${roundId}`;
    } else if (code) {
      endpoint = `./api/room/${encodeURIComponent(code)}/round`;
    }

    if (!endpoint) {
      state = {
        kind: "error",
        message:
          "No round specified in the URL. Share a link like /result?round=42 or /result?room=ABC1.",
      };
      return;
    }

    try {
      const res = await fetch(endpoint);
      if (res.status === 404) {
        state = {
          kind: "error",
          message: roundIdRaw
            ? `Round ${roundIdRaw} isn't recognized. The link may have been mistyped, or the round has aged out of history.`
            : `Room ${code} isn't recognized or has no completed rounds. Rounds are retained for 30 days.`,
        };
        return;
      }
      const body = (await res.json()) as ApiResponse;
      if (body.status === "in_progress") {
        state = {
          kind: "error",
          message: `Room ${code} hasn't finished a round yet. Check back once the players wrap up.`,
        };
        return;
      }
      if (body.status !== "ok") {
        state = { kind: "error", message: "Couldn't load results." };
        return;
      }
      state = { kind: "ok", round: body.round, roomStatus: body.roomStatus };
    } catch (err) {
      state = {
        kind: "error",
        message: `Couldn't load results: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  function roomState(r: StoredRound): RoomState {
    return {
      code: r.roomCode,
      phase: "results",
      board: r.board,
      endsAt: null,
      startsAt: null,
      players: r.players.map((p) => ({
        id: p.id,
        clientId: `shared-${p.id}`,
        name: p.name,
        connected: false,
        ready: false,
        score: p.score,
        words: p.words,
      })),
      hostId: r.hostId,
      settings: r.settings,
      possibleCount: r.possibleWords.length,
      possibleWords: r.possibleWords,
      lastRoundId: r.id,
      forceStartReadyAt: null,
    };
  }

  function fmtWeekday(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
  }
  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  }
  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const statusLabel: Record<RoomStatus, string> = {
    active: "active",
    inactive: "inactive",
    closed: "closed",
  };
</script>

<section id="results" class="stack">
  {#if state.kind === "loading"}
    <h2 class="results-title">Results</h2>
    <div class="result-empty"><p>…</p></div>
  {:else if state.kind === "error"}
    <h2 class="results-title">Results</h2>
    <div class="result-empty">
      <p>{state.message}</p>
      <a class="btn" href="./">back to bawgle</a>
    </div>
  {:else}
    {@const r = state.round}
    <h2 class="results-title results-meta">
      <dl class="meta-list">
        <div class="meta-main">
          <div class="meta-row">
            <dt>Room</dt>
            <dd>
              {#if state.roomStatus !== "closed"}
                <a class="room-link" href={`./?room=${r.roomCode}`}>
                  <code>{r.roomCode}</code>
                  <span class="room-status room-status-{state.roomStatus}">
                    {statusLabel[state.roomStatus]}
                  </span>
                </a>
              {:else}
                <code>{r.roomCode}</code>
                <span class="room-status room-status-closed">
                  {statusLabel.closed}
                </span>
              {/if}
            </dd>
          </div>
          <div class="meta-row">
            <dt>Round</dt>
            <dd>#{r.id}</dd>
          </div>
        </div>
        <div class="meta-row meta-date">
          <dt>Date</dt>
          <dd>
            {fmtWeekday(r.endedAt)}, {fmtDate(r.endedAt)} · {fmtTime(r.endedAt)}
          </dd>
        </div>
      </dl>
    </h2>

    <Results roomState={roomState(r)} meId={null} />

    <div class="results-actions">
      <a class="btn primary result-home-link" href="./">start a new game</a>
    </div>
  {/if}
</section>
