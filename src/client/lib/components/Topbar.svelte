<!--
  Topbar: brand with optional inline room tag, mute button, theme
  cycler. Brand + room stay left-anchored; controls stay right-
  anchored. The room tag reads `(room: CODE)` and only renders when
  the player has joined a room, matching the URL convention.
-->
<script lang="ts">
  import { room } from "../stores/room.ts";
  import { audioEnabled, toggleAudio } from "../stores/audio.ts";
  import { themeKey, themeName, cycleTheme } from "../stores/theme.ts";
</script>

<header class="topbar">
  <a href="./" class="brand-link">
    <h1 class="brand">
      bawgle{#if $room.state?.code}<span class="brand-room">
        (room: <span class="brand-room-code">{$room.state.code}</span>)
      </span>{/if}
    </h1>
  </a>

  <div class="topbar-right">
    <button
      type="button"
      class="mute-btn"
      class:is-muted={!$audioEnabled}
      aria-label="Toggle audio"
      aria-pressed={$audioEnabled ? "false" : "true"}
      title={$audioEnabled ? "Mute audio" : "Unmute audio"}
      onclick={toggleAudio}
    >
      {#if $audioEnabled}
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
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      {:else}
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
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      {/if}
    </button>

    <button
      type="button"
      class="theme-btn"
      aria-label={`Cycle theme (current: ${themeName($themeKey)})`}
      title={themeName($themeKey)}
      onclick={cycleTheme}
    >
      <span class="theme-swatch" aria-hidden="true"></span>
    </button>
  </div>
</header>

<!-- Topbar styles live in the global stylesheet (layout.css). -->
