<!--
  Global feedback toast. Reads from the feedback store and renders
  a position-fixed pill at the top of the viewport. Aria-live region
  so screen readers announce the message.
-->
<script lang="ts">
  import { feedback } from "../stores/feedback.ts";
</script>

<div
  class="feedback"
  class:ok={$feedback.kind === "ok"}
  class:bad={$feedback.kind === "bad"}
  aria-live="polite"
>
  {$feedback.text}
</div>

<style>
  .feedback {
    position: fixed;
    top: env(safe-area-inset-top, 0);
    left: 50%;
    transform: translate(-50%, calc(-100% - 0.5rem));
    margin-top: 0.75rem;
    padding: 0.55rem 1rem;
    border-radius: 999px;
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    background: var(--c-panel);
    border: 1px solid var(--c-border);
    color: var(--c-fg);
    box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.45);
    opacity: 0;
    pointer-events: none;
    z-index: 1000;
    transition:
      transform 180ms ease-out,
      opacity 180ms ease-out;
    white-space: nowrap;
    max-width: min(90vw, 30rem);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .feedback.ok,
  .feedback.bad {
    transform: translate(-50%, 0);
    opacity: 1;
    pointer-events: auto;
  }

  .feedback.ok {
    color: var(--c-good);
    border-color: color-mix(in srgb, var(--c-good) 55%, var(--c-border));
    background: color-mix(in srgb, var(--c-good) 12%, var(--c-panel));
  }

  .feedback.bad {
    color: var(--c-bad);
    border-color: color-mix(in srgb, var(--c-bad) 55%, var(--c-border));
    background: color-mix(in srgb, var(--c-bad) 12%, var(--c-panel));
  }
</style>
