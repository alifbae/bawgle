import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBoardSize,
  isAdjacent,
  neighbors,
  setBoardSize,
} from "../../../src/client/lib/stores/adjacency.ts";
import { createPathStore } from "../../../src/client/lib/stores/path.ts";

describe("isAdjacent / neighbors", () => {
  beforeEach(() => setBoardSize(4));

  it("does not consider a cell adjacent to itself", () => {
    expect(isAdjacent(5, 5)).toBe(false);
  });

  it("treats orthogonal and diagonal cells as adjacent (8-way)", () => {
    for (const n of [0, 1, 2, 4, 6, 8, 9, 10]) {
      expect(isAdjacent(5, n)).toBe(true);
    }
    for (const n of [3, 7, 11, 12, 13, 14, 15]) {
      expect(isAdjacent(5, n)).toBe(false);
    }
  });

  it("neighbors() returns only in-bounds cells for corners", () => {
    const byNum = (a: number, b: number) => a - b;
    expect(neighbors(0).sort(byNum)).toEqual([1, 4, 5]);
    expect(neighbors(3).sort(byNum)).toEqual([2, 6, 7]);
    expect(neighbors(12).sort(byNum)).toEqual([8, 9, 13]);
    expect(neighbors(15).sort(byNum)).toEqual([10, 11, 14]);
  });

  it("respects the configured board size", () => {
    const byNum = (a: number, b: number) => a - b;
    setBoardSize(5);
    expect(getBoardSize()).toBe(5);
    // Center of 5x5 is index 12.
    expect(neighbors(12).sort(byNum)).toEqual([6, 7, 8, 11, 13, 16, 17, 18]);
    setBoardSize(4);
  });
});

describe("createPathStore", () => {
  beforeEach(() => setBoardSize(4));

  it("starts empty and tracks length/last/includes", () => {
    const s = createPathStore();
    expect(s.get()).toEqual([]);
    expect(s.length()).toBe(0);
    expect(s.last()).toBeUndefined();
    expect(s.includes(0)).toBe(false);
  });

  it("push rejects non-adjacent cells after the first", () => {
    const s = createPathStore();
    expect(s.push(0)).toBe(true);
    // 3 is same row but two cells away from 0 — not adjacent.
    expect(s.push(3)).toBe(false);
    expect(s.get()).toEqual([0]);
  });

  it("push rejects duplicates", () => {
    const s = createPathStore();
    s.push(0);
    s.push(1);
    expect(s.push(0)).toBe(false);
    expect(s.push(1)).toBe(false);
  });

  it("trimTo cuts the path at a previously-selected index", () => {
    const s = createPathStore();
    s.push(0);
    s.push(1);
    s.push(2);
    expect(s.trimTo(1)).toBe(true);
    expect(s.get()).toEqual([0, 1]);
    expect(s.trimTo(99)).toBe(false);
  });

  it("pop removes the last index", () => {
    const s = createPathStore();
    s.push(0);
    s.push(1);
    s.pop();
    expect(s.get()).toEqual([0]);
    s.pop();
    s.pop(); // popping empty is a no-op
    expect(s.get()).toEqual([]);
  });

  it("notifies subscribers only when the path changes", () => {
    const s = createPathStore();
    const sub = vi.fn();
    // Svelte stores fire once immediately with the current value.
    const unsub = s.subscribe(sub);
    expect(sub).toHaveBeenCalledTimes(1);

    s.push(0);
    expect(sub).toHaveBeenCalledTimes(2);
    s.push(0); // dupe → rejected, no notify
    expect(sub).toHaveBeenCalledTimes(2);
    s.push(1);
    expect(sub).toHaveBeenCalledTimes(3);

    s.set([0, 1]); // same contents, no notify
    expect(sub).toHaveBeenCalledTimes(3);
    s.set([0]); // different
    expect(sub).toHaveBeenCalledTimes(4);

    s.clear();
    expect(sub).toHaveBeenCalledTimes(5);
    s.clear(); // already empty, no notify
    expect(sub).toHaveBeenCalledTimes(5);

    unsub();
  });

  it("wordText joins the selected cells into a lowercase string", () => {
    const s = createPathStore();
    s.push(0);
    s.push(1);
    s.push(5);
    const board = [
      "C", "A", "T", "S",
      "H", "E", "R", "U",
      "P", "O", "L", "I",
      "D", "N", "E", "G",
    ];
    expect(s.wordText(board)).toBe("cae");
    expect(s.wordText(null)).toBe("");
  });
});
