<!--
  Round countdown. Re-reads endsAt every 250ms so an endsAt update
  (server restart, reconnect) reflects immediately. Adds a `.low`
  class in the last 15% of the round so CSS can pulse it red.
-->
<script lang="ts">
  import { onMount } from "svelte";

  type Props = {
    endsAt: number | null;
  };

  let { endsAt }: Props = $props();

  let totalMs = 0;
  let remain = $state(0);

  // Reset totalMs whenever a new round starts (endsAt transitions from
  // null → number). We snapshot the full round length at that moment
  // to compute the "low" threshold.
  let prevEndsAt: number | null = null;
  $effect(() => {
    if (endsAt !== prevEndsAt) {
      prevEndsAt = endsAt;
      totalMs = endsAt ? Math.max(1, endsAt - Date.now()) : 0;
    }
    // Recompute remain immediately on prop change so the UI isn't
    // stale for up to a tick when the round starts.
    remain = endsAt ? Math.max(0, endsAt - Date.now()) : 0;
  });

  onMount(() => {
    const id = setInterval(() => {
      remain = endsAt ? Math.max(0, endsAt - Date.now()) : 0;
    }, 250);
    return () => clearInterval(id);
  });

  const display = $derived.by(() => {
    const s = Math.floor(remain / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  });
  const low = $derived(totalMs > 0 && remain <= totalMs * 0.15 && remain > 0);
</script>

<span class="timer" class:low>{display}</span>

<!-- Styles shared via global layout.css (.timer). -->
