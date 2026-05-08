<!--
  Top-level app shell. Dispatches to one of three views based on the
  current path:
    /          → Lobby form (pre-connect) or Room view (once connected)
    /result    → Shareable round view
    otherwise  → NotFound
-->
<script lang="ts">
  import { onMount } from "svelte";
  import Lobby from "./lib/components/Lobby.svelte";
  import Topbar from "./lib/components/Topbar.svelte";
  import Feedback from "./lib/components/Feedback.svelte";
  import Room from "./lib/views/Room.svelte";
  import NotFound from "./lib/views/NotFound.svelte";
  import ResultPage from "./lib/views/ResultPage.svelte";

  import { primeOnFirstGesture } from "./lib/util/audio.ts";
  import { connectAndJoin, hasSocket } from "./lib/util/net.ts";
  import { room } from "./lib/stores/room.ts";

  type Route = "app" | "result" | "notFound";

  function classifyRoute(): Route {
    const p = location.pathname.replace(/\/+$/, "");
    if (p.endsWith("/result")) return "result";
    if (p === "" || p === "/" || p.endsWith("/index.html")) return "app";
    return "notFound";
  }

  const route: Route = classifyRoute();

  // Pull any ?room= param once, at boot. The Lobby component uses
  // this to pre-fill the join tab; the auto-reconnect below uses it
  // to skip the lobby entirely if we have a saved name.
  const initialRoomCode = (() => {
    const params = new URLSearchParams(location.search);
    const raw = (params.get("room") || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    return raw || null;
  })();

  onMount(() => {
    primeOnFirstGesture();

    if (route === "app") {
      // Auto-reconnect: saved name + URL code → jump straight into
      // the room. The server handles reconnect-by-clientId so the
      // player slot is restored.
      if (initialRoomCode) {
        const storedName = sessionStorage.getItem("bawgle.name") || "";
        if (storedName) {
          connectAndJoin({ code: initialRoomCode, name: storedName });
        }
      }

      // Dev-only helpers. `__BAWGLE_ENVIRONMENT__` is a compile-time
      // string; the dynamic import is tree-shaken from production.
      if (__BAWGLE_ENVIRONMENT__ === "development") {
        void import("./dev-helpers.ts").then(({ installDevHelpers }) =>
          installDevHelpers(),
        );
      }
    }
  });

  function onLobbySubmit(payload: { code: string; name: string }): void {
    if (hasSocket()) return;
    connectAndJoin(payload);
  }
</script>

<main>
  <Topbar />

  {#if route === "app"}
    {#if $room.state}
      <Room />
    {:else}
      <Lobby initialCode={initialRoomCode} onSubmit={onLobbySubmit} />
    {/if}
  {:else if route === "result"}
    <ResultPage />
  {:else}
    <NotFound />
  {/if}

  <footer class="foot">
    <a
      class="foot-link"
      href="https://github.com/alifbae/bawgle"
      target="_blank"
      rel="noopener"
      aria-label="bawgle on GitHub"
      title="View source on GitHub"
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.93c.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.95-3.2.7-3.87-1.54-3.87-1.54-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.02 11.02 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.15 0 .3.21.66.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
      </svg>
    </a>
  </footer>
</main>

<Feedback />
