// Board adjacency helpers. A single mutable `currentSize` is kept here
// so pointer/keyboard input, the resolver, and the path store all
// agree on what counts as "neighbours" for the board that's actually
// on screen. Any component that receives a new board/size calls
// setBoardSize() before consulting the helpers.

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
