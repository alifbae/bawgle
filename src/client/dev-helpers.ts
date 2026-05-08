/**
 * Development-only helpers exposed as `window.bawgleDev`.
 *
 * Enabled by setting BAWGLE_ENVIRONMENT=development at build time. The
 * bundle tree-shakes this module out of production builds (see
 * `__BAWGLE_ENVIRONMENT__` in vite.config.js).
 *
 * Under the Svelte rewrite, these helpers work by pushing synthetic
 * snapshots into the room store so the component tree renders them —
 * no DOM poking required. Perfect for "what does the results screen
 * look like with three players?" iteration loops.
 */

import { room } from "./lib/stores/room.ts";
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
  void opts.host; // host is tracked via room.hostId, not the player row
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
    startsAt: null,
    players,
    hostId: players[0]?.id ?? null,
    settings: {
      roundSeconds: overrides.roundSeconds ?? 180,
      size: overrides.size ?? 4,
      private: false,
    },
    possibleCount: (overrides.possibleWords ?? DEFAULT_POSSIBLE_4X4).length,
    possibleWords: overrides.possibleWords ?? DEFAULT_POSSIBLE_4X4,
    lastRoundId: null,
    forceStartReadyAt: null,
  };
}

export interface BawgleDev {
  goToResults(options?: SeedOptions): RoomState;
  goToPlaying(options?: SeedOptions): RoomState;
  goToLobby(): void;
  reload(): void;
  makePlayer: typeof makePlayer;
  defaultState: typeof defaultState;
}

export function installDevHelpers(): BawgleDev {
  const api: BawgleDev = {
    goToResults(options = {}) {
      const state = { ...defaultState(options), phase: "results" as const };
      const meId = options.meId ?? state.players[0]?.id ?? "me";
      room.apply({ meId, state });
      return state;
    },
    goToPlaying(options = {}) {
      const state = {
        ...defaultState(options),
        phase: "playing" as const,
        endsAt: Date.now() + (options.roundSeconds ?? 180) * 1000,
      };
      const meId = options.meId ?? state.players[0]?.id ?? "me";
      room.apply({ meId, state });
      return state;
    },
    goToLobby() {
      room.reset();
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
 * Fixed-position dev toolbar.
 */
function renderToolbar(api: BawgleDev): void {
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
