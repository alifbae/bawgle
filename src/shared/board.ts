import type { Board, Cell } from "./types.ts";

// Dice sets for each supported grid size. Sizes 4/5/6 use the canonical
// Boggle, Big Boggle, and Super Big Boggle dice.

const DICE_4X4 = [
  "AAEEGN",
  "ABBJOO",
  "ACHOPS",
  "AFFKPS",
  "AOOTTW",
  "CIMOTU",
  "DEILRX",
  "DELRVY",
  "DISTTY",
  "EEGHNW",
  "EEINSU",
  "EHRTVW",
  "EIOSST",
  "ELRTTY",
  "HIMNUQ", // Q becomes Qu
  "HLNNRZ",
];

// Big Boggle (5x5) — 25 dice
const DICE_5X5 = [
  "AAAFRS",
  "AAEEEE",
  "AAFIRS",
  "ADENNN",
  "AEEEEM",
  "AEEGMU",
  "AEGMNN",
  "AFIRSY",
  "BJKQXZ",
  "CCNSTW",
  "CEIILT",
  "CEILPT",
  "CEIPST",
  "DDHNOT",
  "DHHLOR",
  "DHLNOR",
  "DHLNOR",
  "EIIITT",
  "EMOTTT",
  "ENSSSU",
  "FIPRSY",
  "GORRVW",
  "HIPRRY",
  "NOOTUW",
  "OOOTTU",
];

// Super Big Boggle (6x6) — 36 dice
const DICE_6X6 = [
  "AAAFRS",
  "AAEEEE",
  "AAFIRS",
  "ADENNN",
  "AEEEEM",
  "AEEGMU",
  "AEGMNN",
  "AFIRSY",
  "BBJKXZ",
  "CCENST",
  "CEIILT",
  "CEILPT",
  "CEIPST",
  "DDHNOT",
  "DHHLOR",
  "DHHNOW",
  "DHLNOR",
  "EIIITT",
  "EILPST",
  "EMOTTT",
  "ENSSSU",
  "FIPRSY",
  "GORRVW",
  "HIPRRY",
  "JKQWXZ",
  "NOOTUW",
  "OOOTTU",
  "AAAFRS",
  "AEEEEM",
  "AEEGMU",
  "CCENST",
  "CEIPST",
  "DHHNOW",
  "EIIITT",
  "EMOTTT",
  "ENSSSU",
];

const DICE_SETS: Record<number, string[]> = {
  4: DICE_4X4,
  5: DICE_5X5,
  6: DICE_6X6,
};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rollBoard(size = 4): Board {
  const dice = DICE_SETS[size];
  if (!dice) throw new Error(`unsupported board size ${size}`);
  const shuffled = shuffle(dice);
  return shuffled.map((d) => {
    const ch = d[Math.floor(Math.random() * d.length)];
    return ch === "Q" ? "Qu" : (ch as Cell);
  });
}

/**
 * Check if `word` exists as a valid path on the given board. Each cell used
 * at most once, adjacency is 8-way. Board can be any square size.
 */
export function wordPathExists(board: Board, word: string, size = 4): boolean {
  const target: string[] = [];
  let i = 0;
  const w = word.toUpperCase();
  while (i < w.length) {
    if (w[i] === "Q" && w[i + 1] === "U") {
      target.push("QU");
      i += 2;
    } else {
      target.push(w[i]);
      i += 1;
    }
  }

  const normBoard = board.map((c) => c.toUpperCase());
  const visited = new Array(size * size).fill(false);

  function dfs(idx: number, pos: number): boolean {
    if (pos === target.length) return true;
    const r = Math.floor(idx / size);
    const c = idx % size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const ni = nr * size + nc;
        if (visited[ni]) continue;
        if (normBoard[ni] !== target[pos]) continue;
        visited[ni] = true;
        if (dfs(ni, pos + 1)) return true;
        visited[ni] = false;
      }
    }
    return false;
  }

  for (let i = 0; i < size * size; i++) {
    if (normBoard[i] === target[0]) {
      visited[i] = true;
      if (dfs(i, 1)) return true;
      visited[i] = false;
    }
  }
  return false;
}
