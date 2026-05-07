// Svelte-flavoured word path store. Same semantics as the old
// createPathStore but exposes a `subscribe` hook so components can
// read the path reactively via `$path`.
//
// Adjacency still depends on the current board size; callers set it
// via setBoardSize from game/path.ts whenever a new board arrives.

import { writable } from "svelte/store";
import { isAdjacent as _isAdjacent } from "./adjacency.ts";

export interface PathStore {
  subscribe: (run: (value: number[]) => void) => () => void;
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

export function createPathStore(): PathStore {
  const store = writable<number[]>([]);
  let current: number[] = [];
  store.subscribe((v) => (current = v));

  return {
    subscribe: store.subscribe,
    get: () => current,
    last: () => current[current.length - 1],
    length: () => current.length,
    includes: (i) => current.includes(i),

    push(index) {
      if (current.includes(index)) return false;
      if (current.length > 0 && !_isAdjacent(current[current.length - 1], index)) {
        return false;
      }
      store.set([...current, index]);
      return true;
    },

    trimTo(index) {
      const at = current.indexOf(index);
      if (at === -1) return false;
      store.set(current.slice(0, at + 1));
      return true;
    },

    pop() {
      if (current.length === 0) return;
      store.set(current.slice(0, -1));
    },

    set(next) {
      if (current.length === next.length && next.every((v, i) => v === current[i])) {
        return;
      }
      store.set([...next]);
    },

    clear() {
      if (current.length === 0) return;
      store.set([]);
    },

    wordText(board) {
      if (!board) return "";
      return current
        .map((i) => board[i])
        .join("")
        .toLowerCase();
    },
  };
}
