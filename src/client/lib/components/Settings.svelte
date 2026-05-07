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
      lastSent.roundSeconds === pending.roundSeconds;
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

  function onSliderInput(e: Event): void {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    queue({ roundSeconds: v });
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
    <label class="settings-label" for="round-slider">round</label>
    <input
      id="round-slider"
      type="range"
      min={minRound}
      max={300}
      {step}
      value={settings.roundSeconds}
      oninput={onSliderInput}
      onchange={flush}
    />
    <span class="settings-value">{fmt(settings.roundSeconds)}</span>
  </div>
</div>

<!-- Styles shared via global settings.css. -->
