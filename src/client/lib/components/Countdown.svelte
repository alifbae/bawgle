<!--
  Pre-round countdown ticker. Shown inside the lobby's waiting-host
  slot for the ~5s between "start round" and the round actually
  beginning.
-->
<script lang="ts">
  import { onMount } from "svelte";

  type Props = {
    startsAt: number;
  };

  let { startsAt }: Props = $props();

  let now = $state(Date.now());

  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(id);
  });

  const secs = $derived(Math.max(1, Math.ceil(Math.max(0, startsAt - now) / 1000)));
</script>

<span class="waiting-host">round starting in {secs}…</span>
