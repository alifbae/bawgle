<!--
  Pills row showing every player in the room. Handles host highlight,
  offline dimming, and the lobby-only "ready" check. Scores only show
  outside the lobby (they're all zero in lobby so rendering them is
  noise).
-->
<script lang="ts">
  import type { RoomState } from "../../../shared/types.ts";

  type Props = {
    state: RoomState;
    meId: string | null;
  };

  let { state, meId }: Props = $props();

  const inLobby = $derived(state.phase === "lobby");
  const sorted = $derived([...state.players].sort((a, b) => b.score - a.score));
</script>

<div class="players-row">
  {#each sorted as p (p.id)}
    {@const effectiveReady = inLobby && (p.ready || p.id === state.hostId)}
    <div
      class="player"
      class:me={p.id === meId}
      class:offline={!p.connected}
      class:host={p.id === state.hostId}
      class:ready={effectiveReady}
    >
      <span class="pname">
        {#if p.id === state.hostId}
          <span class="host-mark" title="host">H</span>
        {/if}
        {p.name}
        {#if p.id === meId}
          <span class="me-mark">(you)</span>
        {/if}
        {#if effectiveReady}
          <span class="ready-mark" title="ready">✓</span>
        {/if}
      </span>
      {#if !inLobby}
        <span class="pscore">{p.score}</span>
      {/if}
    </div>
  {/each}
</div>

<!-- Styles shared via global players.css. -->
