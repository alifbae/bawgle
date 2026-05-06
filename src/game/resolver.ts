// Finds a valid Boggle path on the board that spells a given prefix.
// Walks 8-way adjacency, uses each cell at most once, handles "Qu" as one cell.

import { neighbors } from "./path.ts";

function tokens(word: string): string[] {
  const w = word.toUpperCase();
  const out: string[] = [];
  let i = 0;
  while (i < w.length) {
    if (w[i] === "Q" && w[i + 1] === "U") {
      out.push("QU");
      i += 2;
    } else {
      out.push(w[i]);
      i += 1;
    }
  }
  return out;
}

/**
 * Find a valid path for `word` on `board`. If `preferPrefix` is supplied and
 * is itself a valid prefix for `word` on the board, the returned path will
 * start with those exact indices so the visual doesn't jump around while the
 * user is typing.
 */
export function findPathForWord(
  board: string[] | null | undefined,
  word: string,
  preferPrefix: number[] = []
): number[] | null {
  if (!board || !word) return null;
  const needed = tokens(word);
  if (needed.length === 0) return null;

  const faces = board.map((c) => c.toUpperCase());
  const target = needed.map((t) => t.toUpperCase());

  const n = board.length;
  const visited = new Array<boolean>(n).fill(false);

  const prefix: number[] = [];
  for (let i = 0; i < preferPrefix.length && i < target.length; i++) {
    const idx = preferPrefix[i];
    if (idx < 0 || idx >= n) break;
    if (visited[idx]) break;
    const want = target[i];
    const have = faces[idx];
    const ok = want === "QU" ? have === "QU" : have === want;
    if (!ok) break;
    if (prefix.length > 0) {
      const last = prefix[prefix.length - 1];
      const adj = new Set(neighbors(last));
      if (!adj.has(idx)) break;
    }
    prefix.push(idx);
    visited[idx] = true;
  }

  function matches(face: string, want: string): boolean {
    return want === "QU" ? face === "QU" : face === want;
  }

  function dfs(current: number, pos: number): number[] | null {
    if (pos === target.length) return [];
    const options = current === -1 ? [...Array(n).keys()] : neighbors(current);
    for (const next of options) {
      if (visited[next]) continue;
      if (!matches(faces[next], target[pos])) continue;
      visited[next] = true;
      const rest = dfs(next, pos + 1);
      if (rest) return [next, ...rest];
      visited[next] = false;
    }
    return null;
  }

  if (prefix.length === target.length) return prefix;
  const tail = dfs(prefix.length ? prefix[prefix.length - 1] : -1, prefix.length);
  if (tail) return [...prefix, ...tail];

  for (const i of prefix) visited[i] = false;
  const fresh = dfs(-1, 0);
  return fresh ?? null;
}
