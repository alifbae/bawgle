<!--
  "Play again" button with a post-round lockout so nobody drags the
  room back to the lobby before players read the scoreboard.
  Re-arms whenever `armedAt` bumps. The secs countdown is a pure
  derivation of a 1Hz tick while locked.
-->
<script lang="ts">
  import { onMount } from "svelte";

  type Props = {
    visible: boolean;
    /** Timestamp when the lockout was (re)armed. null = not armed. */
    armedAt: number | null;
    onClick: () => void;
  };

  let { visible, armedAt, onClick }: Props = $props();

  const LOCKOUT_MS = 5_000;
  let now = $state(Date.now());

  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(id);
  });

  const remainingMs = $derived(
    armedAt === null ? 0 : Math.max(0, armedAt + LOCKOUT_MS - now),
  );
  const secs = $derived(Math.ceil(remainingMs / 1000));
  const locked = $derived(remainingMs > 0);
</script>

{#if visible}
  <button
    type="button"
    class="btn primary"
    id="play-again-btn"
    class:cooling={locked}
    disabled={locked}
    aria-disabled={locked ? "true" : "false"}
    onclick={onClick}
  >{locked ? `play again (${secs})` : "play again"}</button>
{/if}
