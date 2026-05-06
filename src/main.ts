import { dom } from "./dom.ts";
import { connectAndJoin, hasSocket, send } from "./net.ts";
import { setPhase, flashFeedback } from "./ui/phase.ts";
import { renderPlayers } from "./ui/players.ts";
import { renderBoard, applyPathUI, drawTrail, updateCurrentWord } from "./ui/board.ts";
import { renderMyWords, renderResults } from "./ui/words.ts";
import { startTicker, stopTicker, resetTimer } from "./ui/timer.ts";
import { initThemeSelect } from "./ui/theme-select.ts";
import { initLobby, copyInviteLink } from "./ui/lobby.ts";
import { initSettings, syncSettingsInputs } from "./ui/settings.ts";
import { setClientId } from "./util/client-id.ts";
import { createPathStore } from "./game/path.ts";
import { attachInput } from "./game/input.ts";
import { armPlayAgain, disarmPlayAgain } from "./ui/play-again.ts";
import type { RoomState, ServerMsg } from "../shared/types.ts";

let meId: string | null = null;
let currentState: RoomState | null = null;

const path = createPathStore(() => {
  applyPathUI(path.get());
  drawTrail(path.get());
  updateCurrentWord(path.wordText(currentState?.board));
});

function submitCurrentWord(): void {
  const word = path.wordText(currentState?.board);
  if (word.length >= 3) {
    send({ t: "word", word });
  } else if (word.length > 0) {
    flashFeedback("too short", "bad");
  }
  path.clear();
}

function handleServerMessage(msg: ServerMsg): void {
  switch (msg.t) {
    case "joined":
      meId = msg.you;
      if (msg.state?.code) {
        // Server may have assigned a different clientId when another tab
        // on the same browser was already using ours. Persist whatever
        // we were given so refreshes stick with it.
        setClientId(msg.state.code, msg.clientId);
      }
      applyState(msg.state);
      break;
    case "state":
      applyState(msg.state);
      break;
    case "word_result":
      if (msg.ok) {
        flashFeedback(`+${msg.points ?? 0} ✓ ${msg.word.toUpperCase()}`, "ok");
      } else {
        flashFeedback(`✗ ${msg.reason ?? "rejected"}`, "bad");
      }
      break;
    case "error":
      flashFeedback(msg.message, "bad");
      break;
  }
}

function applyState(state: RoomState): void {
  const prevPhase = currentState?.phase ?? null;
  currentState = state;
  dom.roomCodeDisplay.textContent = state.code;
  updateRoomInUrl(state.code);

  const isHost = !!state.hostId && !!meId && state.hostId === meId;

  renderPlayers(state, meId);
  renderBoard(state.board, state.settings?.size ?? 4);
  applyPathUI(path.get());
  drawTrail(path.get());
  updateCurrentWord(path.wordText(state.board));
  renderMyWords(state, meId);

  dom.roomHeader.hidden = !isHost || state.phase !== "lobby";
  dom.settingsPanel.hidden = !isHost || state.phase !== "lobby";
  syncSettingsInputs(state.settings);

  if (state.phase === "lobby") {
    setPhase("room-idle");

    // Ready-up gating: non-host players confirm they're ready. The host
    // is implicit-ready because clicking "start round" is the confirmation.
    const me = state.players.find((p) => p.id === meId);
    const meReady = !!me?.ready;
    const connected = state.players.filter((p) => p.connected);
    const nonHostConnected = connected.filter((p) => p.id !== state.hostId);
    const allReady =
      nonHostConnected.length === 0 || nonHostConnected.every((p) => p.ready);

    dom.readyBtn.hidden = !me || isHost;
    dom.readyBtn.textContent = meReady ? "not ready" : "i'm ready";
    dom.readyBtn.classList.toggle("is-ready", meReady);

    dom.startBtn.hidden = !isHost;
    dom.startBtn.disabled = !allReady;
    dom.startBtn.textContent = allReady ? "start round" : "waiting for players";
    dom.startBtn.classList.toggle("ready", allReady);
    dom.startBtn.title = allReady ? "" : "all players must be ready";

    dom.startSlot.hidden = false;
    dom.waitingHost.hidden = isHost || meReady || !allReady;
    dom.waitingHost.textContent = allReady
      ? "waiting for host to start the round"
      : "ready up to start the round";

    dom.timer.hidden = true;
    dom.wordBar.hidden = true;
    dom.possibleWords.hidden = true;
    dom.yourWordsRow.hidden = true;
    dom.myWords.hidden = true;
    dom.tutorial.hidden = false;
    dom.boardWrap.hidden = true;
    path.clear();
  } else if (state.phase === "playing") {
    setPhase("playing");
    dom.readyBtn.hidden = true;
    dom.startBtn.hidden = true;
    dom.startSlot.hidden = true;
    dom.waitingHost.hidden = true;
    dom.timer.hidden = false;
    dom.wordBar.hidden = false;
    dom.possibleWords.hidden = false;
    dom.yourWordsRow.hidden = false;
    dom.myWords.hidden = false;
    dom.tutorial.hidden = true;
    dom.boardWrap.hidden = false;
    dom.pwCount.textContent = String(state.possibleCount ?? "–");
    startTicker(() => currentState?.endsAt);
  } else if (state.phase === "results") {
    setPhase("results");
    stopTicker();
    resetTimer();
    renderResults(state, meId);
    dom.readyBtn.hidden = true;
    dom.startBtn.hidden = true;
    dom.startSlot.hidden = true;
    dom.waitingHost.hidden = true;
    dom.timer.hidden = true;
    dom.wordBar.hidden = true;
    dom.possibleWords.hidden = true;
    dom.yourWordsRow.hidden = true;
    dom.myWords.hidden = true;
    dom.tutorial.hidden = true;
    dom.boardWrap.hidden = true;
    path.clear();
    // Lock out "play again" for a few seconds when we first enter the
    // results phase, so no one can drag the room straight back to the
    // lobby before players have a chance to see who won.
    if (prevPhase !== "results") armPlayAgain();
  } else {
    // Left the results phase — make sure the lockout timer can't tick
    // against a hidden button.
    if (prevPhase === "results") disarmPlayAgain();
  }

  dom.playAgainBtn.hidden = !isHost;
}

/* ---------- Input wiring ---------- */

attachInput({
  path,
  onSubmit: submitCurrentWord,
  getBoard: () => currentState?.board,
  getPhase: () => currentState?.phase,
});

dom.undoBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  path.pop();
});

dom.submitBtn.addEventListener("click", submitCurrentWord);
dom.startBtn.addEventListener("click", () => send({ t: "start" }));
dom.playAgainBtn.addEventListener("click", () => send({ t: "lobby" }));

dom.readyBtn.addEventListener("click", () => {
  const me = currentState?.players.find((p) => p.id === meId);
  send({ t: "ready", ready: !me?.ready });
});

dom.copyLinkBtn.addEventListener("click", () => {
  copyInviteLink();
});

window.addEventListener("resize", () => drawTrail(path.get()));

function updateRoomInUrl(code: string | null | undefined): void {
  if (!code) return;
  const url = new URL(location.href);
  if (url.searchParams.get("room") === code) return;
  url.searchParams.set("room", code);
  history.replaceState(null, "", url.toString());
}

/* ---------- Boot ---------- */

initThemeSelect(() => requestAnimationFrame(() => drawTrail(path.get())));

initLobby({
  onSubmit: ({ code, name }) => {
    if (hasSocket()) return;
    connectAndJoin({ code, name }, handleServerMessage);
  },
});

initSettings({
  onChange: (partial) => send({ t: "settings", settings: partial }),
});

setPhase("lobby");

// Auto-reconnect: if the URL has a room code and we have a remembered name,
// skip the lobby form and jump straight into the room. The server handles
// reconnect-by-clientId so the player slot (score, words, host status) is
// restored if this browser was previously in the room.
(function autoReconnect() {
  const params = new URLSearchParams(location.search);
  const code = (params.get("room") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  if (!code) return;
  const storedName = sessionStorage.getItem("bawgle.name");
  if (!storedName) return;
  connectAndJoin({ code, name: storedName }, handleServerMessage);
})();

// Dev-only helpers. The constant is replaced at build time, so the dynamic
// import is eliminated from production bundles via tree-shaking.
if (__BAWGLE_ENVIRONMENT__ === "development") {
  import("./dev-helpers.ts").then(({ installDevHelpers }) => installDevHelpers());
}
