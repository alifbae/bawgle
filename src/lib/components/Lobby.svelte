<!--
  Pre-connect lobby: pick a 4-letter name, host a new room or join an
  existing one by code. Sanitises input aggressively so a bad share
  URL can't land garbage in the code field.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { flashFeedback } from "../stores/feedback.ts";
  import Tutorial from "./Tutorial.svelte";

  type Props = {
    initialCode?: string | null;
    onSubmit: (payload: { code: string; name: string }) => void;
  };

  let { initialCode = null, onSubmit }: Props = $props();

  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function randomCode(length = 4): string {
    let out = "";
    for (let i = 0; i < length; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
  }

  // svelte-ignore state_referenced_locally
  let tab: "host" | "join" = $state(initialCode ? "join" : "host");
  let name = $state<string>("");
  let hostCode = $state<string>(randomCode());
  // svelte-ignore state_referenced_locally
  let joinCode: string = $state(initialCode ?? "");

  onMount(() => {
    // Seed name from session storage so returning players don't retype.
    try {
      const stored = (sessionStorage.getItem("bawgle.name") || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 4);
      if (stored) name = stored;
    } catch {
      /* storage disabled */
    }
  });

  function clean(v: string): string {
    return v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  }

  function onNameInput(e: Event): void {
    name = clean((e.currentTarget as HTMLInputElement).value);
  }
  function onJoinInput(e: Event): void {
    joinCode = clean((e.currentTarget as HTMLInputElement).value);
  }

  async function copyCode(): Promise<void> {
    if (!hostCode) return;
    try {
      await navigator.clipboard.writeText(hostCode);
      flashFeedback("code copied", "ok");
    } catch {
      window.prompt("Copy room code:", hostCode);
    }
  }

  function submitHost(): void {
    if (!name) {
      flashFeedback("enter a name", "bad");
      return;
    }
    if (!hostCode) return;
    try {
      sessionStorage.setItem("bawgle.name", name);
    } catch {
      /* ignore */
    }
    onSubmit({ code: hostCode, name });
  }

  function submitJoin(): void {
    if (!name) {
      flashFeedback("enter a name", "bad");
      return;
    }
    if (!joinCode) return;
    try {
      sessionStorage.setItem("bawgle.name", name);
    } catch {
      /* ignore */
    }
    onSubmit({ code: joinCode, name });
  }
</script>

<section id="lobby" class="stack">
  <div class="card">
    <div class="tabs" role="tablist" aria-label="Join or host">
      <button
        type="button"
        class="tab"
        class:is-active={tab === "host"}
        role="tab"
        aria-selected={tab === "host" ? "true" : "false"}
        onclick={() => (tab = "host")}
      >host</button>
      <button
        type="button"
        class="tab"
        class:is-active={tab === "join"}
        role="tab"
        aria-selected={tab === "join" ? "true" : "false"}
        onclick={() => (tab = "join")}
      >join</button>
    </div>

    <div class="field">
      <label for="name-input">name</label>
      <input
        id="name-input"
        maxlength="4"
        autocomplete="off"
        inputmode="text"
        placeholder="____"
        spellcheck="false"
        autocapitalize="characters"
        value={name}
        oninput={onNameInput}
      />
    </div>

    {#if tab === "host"}
      <div class="tab-panel">
        <div class="field">
          <label for="host-code">room code</label>
          <div class="code-row">
            <input id="host-code" readonly aria-readonly="true" value={hostCode} />
            <button
              type="button"
              class="btn icon-only"
              aria-label="Copy room code"
              title="Copy code"
              onclick={copyCode}
            >
              <svg
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
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            </button>
            <button
              type="button"
              class="btn icon-only"
              aria-label="Generate a new code"
              title="New code"
              onclick={() => (hostCode = randomCode())}
            >↻</button>
          </div>
        </div>
        <button class="btn primary" onclick={submitHost}>host room</button>
      </div>
    {:else}
      <div class="tab-panel">
        <div class="field">
          <label for="join-code">room code</label>
          <input
            id="join-code"
            maxlength="4"
            autocomplete="off"
            placeholder="____"
            value={joinCode}
            oninput={onJoinInput}
          />
        </div>
        <button class="btn primary" onclick={submitJoin}>join room</button>
      </div>
    {/if}
  </div>

  <Tutorial variant="lobby" />
</section>

<!-- Styles shared via global lobby.css. -->
