/**
 * Development-only helpers exposed as `window.bawgleDev`.
 *
 * Enabled by setting BAWGLE_ENVIRONMENT=development at build time. The
 * bundle tree-shakes this module out of production builds (see
 * `__BAWGLE_ENVIRONMENT__` in vite.config.js).
 *
 * Intended purely for fast UI iteration: "what does the results screen
 * look like when there are three players with a mix of words?" Open the
 * browser console and call e.g. `bawgleDev.goToResults()` to jump
 * straight there without running a full round.
 */

import { dom } from "./dom.ts";
import { setPhase } from "./ui/phase.ts";
import { renderPlayers } from "./ui/players.ts";
import { renderResults, renderMyWords } from "./ui/words.ts";
import { renderBoard } from "./ui/board.ts";
import { armPlayAgain, disarmPlayAgain } from "./ui/play-again.ts";
import type { Player, RoomState } from "../shared/types.ts";

interface SeedOptions {
  /** Override the local "me" id. Defaults to the first player. */
  meId?: string;
  /** Override the room code. Default "DEV1". */
  code?: string;
  /** Board faces, row-major. Defaults to a classic Boggle set. */
  board?: string[];
  /** Grid edge length. Defaults to 4. */
  size?: 4 | 5 | 6;
  /** Seconds for this round — cosmetic in results phase. */
  roundSeconds?: number;
  /** Players array. Default is a pre-baked trio with realistic word lists. */
  players?: Player[];
  /** Total possible words the solver would've found. */
  possibleWords?: string[];
}

const DEFAULT_BOARD_4X4 = [
  "C", "A", "T", "S",
  "H", "E", "R", "U",
  "D", "O", "G", "P",
  "M", "N", "O", "P",
];

/** A handful of realistic words reachable on DEFAULT_BOARD_4X4. */
const DEFAULT_POSSIBLE_4X4 = [
  "ace", "act", "age", "ago", "arc", "are", "art", "ate", "cat",
  "cos", "cue", "cur", "cut", "dog", "doh", "eat", "ego", "era",
  "got", "her", "hot", "mon", "ops", "our", "pop", "pug", "rug",
  "rue", "sue", "teh", "tea", "top", "tor", "cats", "cars", "care",
  "arts", "cure", "date", "gate", "goes", "hats", "hate", "head",
  "heat", "her", "hers", "hoes", "mode", "node", "pogo", "pops",
  "caters", "charge", "detach", "graces", "charts", "charmed",
  "chores", "chrome", "cartops", "scarred", "charred", "cheater",
];

function makePlayer(
  id: string,
  name: string,
  words: string[],
  opts: { connected?: boolean; ready?: boolean; host?: boolean } = {},
): Player {
  return {
    id,
    clientId: `dev-${id}`,
    name,
    connected: opts.connected ?? true,
    ready: opts.ready ?? true,
    score: words.reduce((s, w) => s + Math.max(0, w.length - 2), 0),
    words: [...words],
  };
}

/** Build a reasonable default results-screen state. */
function defaultState(overrides: SeedOptions = {}): RoomState {
  const players = overrides.players ?? [
    makePlayer("me", "ALFA", ["cat", "cats", "are", "arts", "cure", "caters", "charge"], { host: true }),
    makePlayer("p2", "BETA", ["dog", "hate", "rue", "arc", "charts"]),
    makePlayer("p3", "GAMA", ["age", "ego", "tea", "detach", "chores", "cheater"]),
  ];
  const board = overrides.board ?? DEFAULT_BOARD_4X4;
  return {
    code: overrides.code ?? "DEV1",
    phase: "results",
    board,
    endsAt: null,
    players,
    hostId: players[0]?.id ?? null,
    settings: {
      roundSeconds: overrides.roundSeconds ?? 180,
      size: overrides.size ?? 4,
    },
    possibleCount: (overrides.possibleWords ?? DEFAULT_POSSIBLE_4X4).length,
    possibleWords: overrides.possibleWords ?? DEFAULT_POSSIBLE_4X4,
  };
}

/** Reach into the same DOM switches main.ts uses for the results phase. */
function renderResultsState(state: RoomState, meId: string): void {
  setPhase("results");
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
  renderResults(state, meId);
  dom.playAgainBtn.hidden = state.hostId !== meId;
  armPlayAgain();
}

function renderPlayingState(state: RoomState, meId: string): void {
  setPhase("playing");
  disarmPlayAgain();
  dom.readyBtn.hidden = true;
  dom.startBtn.hidden = true;
  dom.startSlot.hidden = true;
  dom.waitingHost.hidden = true;
  dom.timer.hidden = false;
  dom.timer.textContent = formatRemaining(state.endsAt);
  dom.wordBar.hidden = false;
  dom.possibleWords.hidden = false;
  dom.yourWordsRow.hidden = false;
  dom.myWords.hidden = false;
  dom.tutorial.hidden = true;
  dom.boardWrap.hidden = false;
  dom.pwCount.textContent = String(state.possibleCount);
  renderBoard(state.board ?? [], state.settings.size);
  renderPlayers(state, meId);
  renderMyWords(state, meId);
  dom.roomCodeDisplay.textContent = state.code;
}

function formatRemaining(endsAt: number | null): string {
  if (!endsAt) return "03:00";
  const ms = Math.max(0, endsAt - Date.now());
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface BawgleDev {
  /** Jump straight to a populated results screen. Returns the state used. */
  goToResults(options?: SeedOptions): RoomState;
  /** Jump to a playing state with a live-looking word list. */
  goToPlaying(options?: SeedOptions): RoomState;
  /** Reset the UI back to the lobby. */
  goToLobby(): void;
  /** Swap out of dev mode by reloading the page clean. */
  reload(): void;
  /** Quick access to the shapes used under the hood, if you want to tweak. */
  makePlayer: typeof makePlayer;
  defaultState: typeof defaultState;
}

export function installDevHelpers(): BawgleDev {
  const api: BawgleDev = {
    goToResults(options = {}) {
      const state = { ...defaultState(options), phase: "results" as const };
      const meId = options.meId ?? state.players[0]?.id ?? "me";
      renderResultsState(state, meId);
      return state;
    },
    goToPlaying(options = {}) {
      const state = {
        ...defaultState(options),
        phase: "playing" as const,
        endsAt: Date.now() + (options.roundSeconds ?? 180) * 1000,
      };
      const meId = options.meId ?? state.players[0]?.id ?? "me";
      renderPlayingState(state, meId);
      return state;
    },
    goToLobby() {
      disarmPlayAgain();
      setPhase("lobby");
    },
    reload() {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      location.href = url.toString();
    },
    makePlayer,
    defaultState,
  };

  (globalThis as unknown as { bawgleDev: BawgleDev }).bawgleDev = api;
  renderToolbar(api);
  console.info(
    "%c[bawgle:dev]",
    "color:#7dd3fc;font-weight:600",
    "helpers ready. Try bawgleDev.goToResults() or bawgleDev.goToPlaying().",
  );
  return api;
}

/**
 * Fixed-position dev toolbar. Injects its own styles so it doesn't bleed
 * into the app CSS. Collapses to a tiny badge on click so it can't obscure
 * the UI during testing.
 */
function renderToolbar(api: BawgleDev): void {
  // Avoid double-mount on HMR.
  document.getElementById("bawgle-dev-toolbar")?.remove();

  const style = document.createElement("style");
  style.textContent = `
    #bawgle-dev-toolbar {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.5rem;
      background: #111827;
      color: #f3f4f6;
      border: 1px dashed #7dd3fc;
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
      transition: opacity 150ms ease;
    }
    #bawgle-dev-toolbar[data-collapsed="true"] {
      gap: 0;
      padding: 0.35rem 0.55rem;
    }
    #bawgle-dev-toolbar .dev-label {
      color: #7dd3fc;
      font-weight: 700;
      letter-spacing: 0.05em;
      padding-right: 0.25rem;
      cursor: pointer;
      user-select: none;
    }
    #bawgle-dev-toolbar button {
      appearance: none;
      background: #1f2937;
      color: #f3f4f6;
      border: 1px solid #374151;
      border-radius: 4px;
      padding: 0.3rem 0.55rem;
      font: inherit;
      cursor: pointer;
    }
    #bawgle-dev-toolbar button:hover { background: #374151; }
    #bawgle-dev-toolbar button:active { background: #111827; }
    #bawgle-dev-toolbar[data-collapsed="true"] button { display: none; }
  `;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.id = "bawgle-dev-toolbar";
  bar.setAttribute("data-collapsed", "false");
  bar.innerHTML = `
    <span class="dev-label" title="click to toggle">dev</span>
    <button type="button" data-cmd="results">results</button>
    <button type="button" data-cmd="playing">playing</button>
    <button type="button" data-cmd="lobby">lobby</button>
    <button type="button" data-cmd="reload" title="Clean reload (clears ?room)">reload</button>
  `;
  document.body.appendChild(bar);

  bar.querySelector<HTMLElement>(".dev-label")!.addEventListener("click", () => {
    const collapsed = bar.getAttribute("data-collapsed") === "true";
    bar.setAttribute("data-collapsed", collapsed ? "false" : "true");
  });

  bar.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const cmd = target.getAttribute("data-cmd");
    if (!cmd) return;
    switch (cmd) {
      case "results":
        api.goToResults();
        break;
      case "playing":
        api.goToPlaying();
        break;
      case "lobby":
        api.goToLobby();
        break;
      case "reload":
        api.reload();
        break;
    }
  });
}
