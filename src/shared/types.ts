export type Cell = string; // one die face, uppercase. "Qu" is stored as "Qu"

export type Board = Cell[]; // length 16 for 4x4

export interface Player {
  id: string;
  // Stable per-browser identity. Clients persist this in localStorage so a
  // refresh reuses the same player slot instead of creating a ghost.
  clientId: string;
  name: string;
  connected: boolean;
  ready: boolean;
  score: number;
  words: string[]; // accepted words, lowercase
}

export type RoundPhase = "lobby" | "playing" | "results";

export interface RoomSettings {
  // Round length in seconds. Clamped server-side to MIN/MAX.
  roundSeconds: number;
  // Board edge length. 4 (Boggle), 5 (Big Boggle), 6 (Super Big Boggle).
  size: 4 | 5 | 6;
  /**
   * When true the room is hidden from `/api/rooms/public` so casual
   * drive-bys on the lobby list can't see it or join. The 4-letter
   * code still works as a direct/share URL. Default is false so
   * existing behavior (public = visible) is unchanged.
   */
  private: boolean;
}

export const SETTINGS_LIMITS = {
  minRoundSeconds: 60,
  // Development builds bend the lower bound for fast iteration: see
  // DEV_MIN_ROUND_SECONDS below. Production always clamps at 60.
  maxRoundSeconds: 300,
  sizes: [4, 5, 6] as const,
};

/**
 * Relaxed lower bound used when BAWGLE_ENVIRONMENT=development.
 * 5 seconds is short enough to end a round manually in a single click
 * while still giving the client a visible countdown.
 */
export const DEV_MIN_ROUND_SECONDS = 5;

export const DEFAULT_SETTINGS: RoomSettings = {
  roundSeconds: 180,
  size: 4,
  private: false,
};

export interface RoomState {
  code: string;
  phase: RoundPhase;
  board: Board | null;
  endsAt: number | null; // epoch ms — round end
  /**
   * Epoch ms when the round will transition from lobby to playing.
   * Non-null only during the brief pre-round countdown (~5s) kicked
   * off by the host clicking "start." Clients render a countdown
   * based on this, the server actually flips the phase.
   */
  startsAt: number | null;
  players: Player[];
  hostId: string | null;
  settings: RoomSettings;
  possibleCount: number;
  possibleWords: string[];
  // Numeric id of the most recent completed round, if any. Clients use
  // this to generate stable /result?round=N share links. Null until the
  // first round of the session ends.
  lastRoundId: number | null;
  /**
   * When the host has tried to start a round but some players aren't
   * ready, the server arms a grace window. `forceStartReadyAt` is the
   * epoch ms after which the host may send `{t: "start", force: true}`
   * to begin the round anyway. Null when there's no pending override
   * (either everyone's ready, the host hasn't tried yet, or a
   * ready-up resolved the stall).
   */
  forceStartReadyAt: number | null;
}

/* Client -> server */
export type ClientMsg =
  | { t: "join"; code: string; name: string; clientId: string }
  /**
   * Host-initiated round start. With `force: true` the host overrides
   * the "everyone ready" gate — only honoured after the room has been
   * in the force-start window long enough (see
   * `RoomState.forceStartReadyAt`). A force flag in any other context
   * is ignored.
   */
  | { t: "start"; force?: boolean }
  | { t: "lobby" }
  | { t: "ready"; ready: boolean }
  | { t: "word"; word: string }
  | { t: "settings"; settings: Partial<RoomSettings> }
  | { t: "leave" };

/* Server -> client */
export type ServerMsg =
  | { t: "joined"; you: string; clientId: string; state: RoomState }
  | { t: "state"; state: RoomState }
  | { t: "word_result"; word: string; ok: boolean; reason?: string; points?: number }
  | { t: "error"; message: string };

export function scoreWord(word: string): number {
  const len = word.length;
  if (len < 3) return 0;
  return len - 2;
}
