<!--
  404 view. The server's SPA catch-all serves the bundle for any URL
  so typos land here rather than silently loading the lobby.
-->
<script lang="ts">
  import { onMount } from "svelte";

  let path = $state<string>("");

  onMount(() => {
    document.body.classList.add("is-404-page");
    path = location.pathname;
    return () => {
      document.body.classList.remove("is-404-page");
    };
  });
</script>

<section id="results" class="stack">
  <h2 class="results-title">404 — page not found</h2>
  <div class="result-empty">
    <p class="not-found-big">404</p>
    <p>The page <code>{path}</code> doesn't exist.</p>
    <a class="btn primary" href="./">back to bawgle</a>
  </div>
</section>
