// Pure state for the currently-being-built word: which board indices are
// selected and in what order. Adjacency math takes a size so the same store
// works for 4x4, 5x5, 6x6 boards.

let currentSize = 4;

export function setBoardSize(size: number): void {
  currentSize = size;
}

export function getBoardSize(): number {
  return currentSize;
}

export function isAdjacent(a: number, b: number): boolean {
  if (a === b) return false;
  const size = currentSize;
  const ar = Math.floor(a / size);
  const ac = a % size;
  const br = Math.floor(b / size);
  const bc = b % size;
  return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1;
}

export function neighbors(index: number): number[] {
  const size = currentSize;
  const r = Math.floor(index / size);
  const c = index % size;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      out.push(nr * size + nc);
    }
  }
  return out;
}

export interface PathStore {
  get(): number[];
  last(): number | undefined;
  length(): number;
  includes(i: number): boolean;
  push(index: number): boolean;
  trimTo(index: number): boolean;
  pop(): void;
  set(next: number[]): void;
  clear(): void;
  wordText(board: string[] | null | undefined): string;
}

export function createPathStore(onChange?: () => void): PathStore {
  let indices: number[] = [];

  return {
    get: () => indices,
    last: () => indices[indices.length - 1],
    length: () => indices.length,
    includes: (i) => indices.includes(i),

    push(index) {
      if (indices.includes(index)) return false;
      if (indices.length > 0 && !isAdjacent(indices[indices.length - 1], index)) {
        return false;
      }
      indices.push(index);
      onChange?.();
      return true;
    },

    trimTo(index) {
      const at = indices.indexOf(index);
      if (at === -1) return false;
      indices = indices.slice(0, at + 1);
      onChange?.();
      return true;
    },

    pop() {
      if (indices.length === 0) return;
      indices.pop();
      onChange?.();
    },

    set(next) {
      const sameLen = indices.length === next.length;
      if (sameLen && next.every((v, i) => v === indices[i])) return;
      indices = [...next];
      onChange?.();
    },

    clear() {
      if (indices.length === 0) return;
      indices = [];
      onChange?.();
    },

    wordText(board) {
      if (!board) return "";
      return indices
        .map((i) => board[i])
        .join("")
        .toLowerCase();
    },
  };
}
