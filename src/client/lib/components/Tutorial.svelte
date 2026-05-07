<!--
  Pre-round how-to-play card. Shown under the lobby card and also in
  place of the empty board before a round starts. Pure presentation.
-->
<script lang="ts">
  type Props = { variant?: "lobby" | "room" };
  let { variant = "room" }: Props = $props();
</script>

<div class="tutorial" class:lobby-tutorial={variant === "lobby"}>
  <h2 class="tutorial-title">how to play</h2>
  <ol class="tutorial-steps">
    <li>
      <span class="step-num">1</span>
      <span>Form words by connecting adjacent letters. Letters may touch
        horizontally, vertically, or diagonally.</span>
    </li>
    <li>
      <span class="step-num">2</span>
      <span>
        <span class="desktop-only">Tap, slide, or type letters on the board.</span>
        <span class="touch-only">Tap or slide across letters on the board.</span>
        Each tile can only be used once per word.
      </span>
    </li>
    <li>
      <span class="step-num">3</span>
      <span>Each word must be at least 3 letters. Longer words score more points.</span>
    </li>
    <li>
      <span class="step-num">4</span>
      <span>The player with the most points when the timer ends wins.</span>
    </li>
  </ol>
</div>

<!-- Styles shared via global tutorial.css. -->
