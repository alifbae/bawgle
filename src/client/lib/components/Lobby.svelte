<!--
  Pre-connect lobby: pick a 4-letter name, host a new room or join an
  existing one by code. Sanitises input aggressively so a bad share
  URL can't land garbage in the code field.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { flashFeedback } from "../stores/feedback.ts";
  import PublicRooms from "./PublicRooms.svelte";

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

  // Default to the join tab — visitors hitting the root URL want to
  // jump into an existing game first. An `initialCode` from the URL
  // also lands on join, and a user can still flip to host with one
  // click if nothing's running.
  let tab: "host" | "join" = $state("join");
  let name = $state<string>("");
  let hostCode = $state<string>(randomCode());
  // svelte-ignore state_referenced_locally
  let joinCode: string = $state(initialCode ?? "");
  // Flipped on when the user presses host/join without a name. Clears
  // as soon as they type a character. Drives the error outline on the
  // input and the inline message under it.
  let nameError = $state<boolean>(false);
  let nameInputEl: HTMLInputElement | null = $state(null);
  // Same pattern as nameError but for the join-code field. Only the
  // join tab uses this — the host tab generates its own code so it
  // can't be empty.
  let joinCodeError = $state<boolean>(false);
  let joinCodeInputEl: HTMLInputElement | null = $state(null);

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
    if (nameError && name) nameError = false;
  }
  function onJoinInput(e: Event): void {
    joinCode = clean((e.currentTarget as HTMLInputElement).value);
    if (joinCodeError && joinCode) joinCodeError = false;
  }

  /**
   * Switch between host/join tabs. Clears any inline field errors on
   * the way so a user who clicked "join room" without a name/code
   * and then flips to "host" doesn't see a stale red outline on the
   * shared name field.
   */
  function selectTab(next: "host" | "join"): void {
    if (tab === next) return;
    tab = next;
    nameError = false;
    joinCodeError = false;
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
      flagMissingName();
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
      flagMissingName();
      return;
    }
    if (!joinCode) {
      flagMissingJoinCode();
      return;
    }
    try {
      sessionStorage.setItem("bawgle.name", name);
    } catch {
      /* ignore */
    }
    onSubmit({ code: joinCode, name });
  }

  /**
   * Highlight the name field and focus it so the user's next
   * keystroke lands in the right place. Toast stays for consistency
   * with other inline-validated forms, but the real signal is the
   * red outline + inline message tied to the field.
   */
  function flagMissingName(): void {
    nameError = true;
    flashFeedback("enter a name", "bad");
    nameInputEl?.focus();
  }

  /** Same idea as flagMissingName, but for the join-code field. */
  function flagMissingJoinCode(): void {
    joinCodeError = true;
    flashFeedback("enter a room code", "bad");
    joinCodeInputEl?.focus();
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
        onclick={() => selectTab("host")}
      >host</button>
      <button
        type="button"
        class="tab"
        class:is-active={tab === "join"}
        role="tab"
        aria-selected={tab === "join" ? "true" : "false"}
        onclick={() => selectTab("join")}
      >join</button>
    </div>

    <div class="field" class:has-error={nameError}>
      <label for="name-input">name</label>
      <input
        bind:this={nameInputEl}
        id="name-input"
        maxlength="4"
        autocomplete="off"
        inputmode="text"
        placeholder="____"
        spellcheck="false"
        autocapitalize="characters"
        aria-invalid={nameError ? "true" : undefined}
        aria-describedby={nameError ? "name-input-error" : undefined}
        value={name}
        oninput={onNameInput}
      />
      {#if nameError}
        <span id="name-input-error" class="field-error">enter a name to continue</span>
      {/if}
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
        <div class="field" class:has-error={joinCodeError}>
          <label for="join-code">room code</label>
          <input
            bind:this={joinCodeInputEl}
            id="join-code"
            maxlength="4"
            autocomplete="off"
            placeholder="____"
            aria-invalid={joinCodeError ? "true" : undefined}
            aria-describedby={joinCodeError ? "join-code-error" : undefined}
            value={joinCode}
            oninput={onJoinInput}
          />
          {#if joinCodeError}
            <span id="join-code-error" class="field-error">enter a room code to continue</span>
          {/if}
        </div>
        <button class="btn primary" onclick={submitJoin}>join room</button>
        <PublicRooms
          onPick={(code) => {
            joinCode = code;
            // One-tap join when a name is already typed — no extra
            // button press, no fumbling on mobile. Without a name
            // we can't proceed, so surface the same name-missing
            // error the manual "join room" button shows instead of
            // silently dropping the click.
            if (name) {
              submitJoin();
            } else {
              flagMissingName();
            }
          }}
          onHostRequest={() => selectTab("host")}
        />
      </div>
    {/if}
  </div>
</section>

<!-- Styles shared via global lobby.css. -->
