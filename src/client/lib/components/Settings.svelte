<!--
  Host-only lobby settings: grid size + round length. Emits a partial
  RoomSettings on change; the parent decides how to ship it to the
  server. Slider input debounces; change (release) flushes.
-->
<script lang="ts">
  import { DEV_MIN_ROUND_SECONDS, type RoomSettings } from "../../../shared/types.ts";

  type Props = {
    settings: RoomSettings;
    onChange: (s: Partial<RoomSettings>) => void;
  };

  let { settings, onChange }: Props = $props();

  // Dev builds lower the slider floor to a few seconds for fast
  // iteration. Server applies the same relaxation when
  // BAWGLE_ENVIRONMENT=development.
  const minRound = __BAWGLE_ENVIRONMENT__ === "development"
    ? DEV_MIN_ROUND_SECONDS
    : 60;
  const step = __BAWGLE_ENVIRONMENT__ === "development" ? 5 : 15;

  let pending: Partial<RoomSettings> | null = null;
  let lastSent: Partial<RoomSettings> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function queue(partial: Partial<RoomSettings>): void {
    pending = { ...(pending || {}), ...partial };
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, 300);
  }

  function flush(): void {
    if (!pending) return;
    const same =
      lastSent &&
      lastSent.size === pending.size &&
      lastSent.roundSeconds === pending.roundSeconds &&
      lastSent.private === pending.private;
    if (!same) {
      onChange(pending);
      lastSent = { ...pending };
    }
    pending = null;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function pickSize(size: 4 | 5 | 6): void {
    queue({ size });
    flush();
  }

  function pickVisibility(isPrivate: boolean): void {
    if (isPrivate === settings.private) return;
    queue({ private: isPrivate });
    flush();
  }

  // Live slider value that updates on every drag movement. Tracks
  // the server-confirmed `settings.roundSeconds` by default; flips
  // to a locally-tracked value while the user is dragging so the
  // label reflects the current slider position in real time.
  let dragValue = $state<number | null>(null);
  const liveSeconds = $derived(dragValue ?? settings.roundSeconds);

  function onSliderInput(e: Event): void {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    dragValue = v;
    queue({ roundSeconds: v });
  }

  function onSliderChange(): void {
    // On release: flush to the server, then drop the local override
    // so subsequent server updates flow through.
    flush();
    dragValue = null;
  }

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
</script>

<div class="settings-panel">
  <div class="settings-row">
    <div class="settings-label">grid</div>
    <div class="seg" role="radiogroup" aria-label="Grid size">
      {#each [4, 5, 6] as size (size)}
        <button
          type="button"
          class="seg-btn"
          role="radio"
          aria-checked={settings.size === size ? "true" : "false"}
          onclick={() => pickSize(size as 4 | 5 | 6)}
        >{size}×{size}</button>
      {/each}
    </div>
  </div>
  <div class="settings-row">
    <label class="settings-label" for="round-slider">duration</label>
    <input
      id="round-slider"
      type="range"
      min={minRound}
      max={300}
      {step}
      value={settings.roundSeconds}
      oninput={onSliderInput}
      onchange={onSliderChange}
    />
    <span class="settings-value">{fmt(liveSeconds)}</span>
  </div>
  <div class="settings-row">
    <div class="settings-label">visibility</div>
    <div class="seg" role="radiogroup" aria-label="Room visibility">
      <button
        type="button"
        class="seg-btn"
        role="radio"
        aria-checked={!settings.private ? "true" : "false"}
        onclick={() => pickVisibility(false)}
      >public</button>
      <button
        type="button"
        class="seg-btn"
        role="radio"
        aria-checked={settings.private ? "true" : "false"}
        onclick={() => pickVisibility(true)}
      >private</button>
    </div>
  </div>
</div>

<!-- Styles shared via global settings.css. -->
