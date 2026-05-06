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
}

export const SETTINGS_LIMITS = {
  minRoundSeconds: 60,
  maxRoundSeconds: 300,
  sizes: [4, 5, 6] as const,
};

export const DEFAULT_SETTINGS: RoomSettings = {
  roundSeconds: 180,
  size: 4,
};

export interface RoomState {
  code: string;
  phase: RoundPhase;
  board: Board | null;
  endsAt: number | null; // epoch ms
  players: Player[];
  hostId: string | null;
  settings: RoomSettings;
  possibleCount: number;
  possibleWords: string[];
}

/* Client -> server */
export type ClientMsg =
  | { t: "join"; code: string; name: string; clientId: string }
  | { t: "start" }
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
