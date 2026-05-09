import { beforeEach, describe, expect, it } from "vitest";
import { setBoardSize } from "../../../src/client/lib/stores/adjacency.ts";
import { findPathForWord } from "../../../src/client/lib/util/resolver.ts";

describe("findPathForWord", () => {
  beforeEach(() => setBoardSize(4));

  const board = [
    "C",
    "A",
    "T",
    "S",
    "H",
    "E",
    "R",
    "U",
    "P",
    "O",
    "L",
    "I",
    "D",
    "N",
    "E",
    "G",
  ];

  it("returns null for empty or missing inputs", () => {
    expect(findPathForWord(board, "")).toBeNull();
    expect(findPathForWord(null, "cat")).toBeNull();
    expect(findPathForWord(undefined, "cat")).toBeNull();
  });

  it("finds any valid path for a word on the board", () => {
    const path = findPathForWord(board, "cats");
    expect(path).not.toBeNull();
    expect(path).toHaveLength(4);
    const letters = path!.map((i: number) => board[i]).join("");
    expect(letters.toUpperCase()).toBe("CATS");
  });

  it("returns null when the word cannot be spelled", () => {
    expect(findPathForWord(board, "zzz")).toBeNull();
    expect(findPathForWord(board, "catsup")).toBeNull();
  });

  it("honors a valid prefix so the UI doesn't jump around", () => {
    // C at index 0, A at 1. Force the first two indices, then extend.
    const path = findPathForWord(board, "cat", [0, 1]);
    expect(path).not.toBeNull();
    expect(path!.slice(0, 2)).toEqual([0, 1]);
  });

  it("ignores an invalid prefix and still finds a path", () => {
    // [0, 3] is C...S — not adjacent, so prefix rejected, but we still
    // expect a full path to be returned because CATS exists.
    const path = findPathForWord(board, "cats", [0, 3]);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(4);
  });

  it("handles the Qu digraph as a single cell", () => {
    const qBoard = [
      "Qu",
      "E",
      "E",
      "N",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
    ];
    const path = findPathForWord(qBoard, "queen");
    expect(path).not.toBeNull();
    // "Qu" eats Q+U, so the path length is one shorter than the letter count.
    expect(path!).toHaveLength(4);
    expect(qBoard[path![0]]).toBe("Qu");
  });

  // ─── Determinism ─────────────────────────────────────────────
  //
  // Regression guard for the results-preview "cycling between two
  // paths" bug: if a word can be traced multiple valid ways on the
  // board, the resolver must pick the same one every time. Otherwise
  // the preview board flips between paths on every chip hover.

  describe("determinism", () => {
    it("returns the same path on repeated calls for a word with multiple solutions", () => {
      // "ee" exists at (0,2), (1,0) and many neighbouring pairs.
      const multiBoard = [
        "E", "E", "E", "E",
        "E", "X", "Y", "E",
        "E", "Z", "W", "E",
        "E", "E", "E", "E",
      ];
      const first = findPathForWord(multiBoard, "ee");
      expect(first).not.toBeNull();
      for (let i = 0; i < 20; i++) {
        expect(findPathForWord(multiBoard, "ee")).toEqual(first);
      }
    });

    it("picks one deterministic path for an ambiguous longer word", () => {
      // "ANNA" can be traced 0→1→5→4 or 0→4→5→1 etc.
      const annaBoard = [
        "A", "N", "X", "X",
        "N", "A", "X", "X",
        "X", "X", "X", "X",
        "X", "X", "X", "X",
      ];
      const runs = Array.from({ length: 10 }, () =>
        findPathForWord(annaBoard, "anna"),
      );
      expect(runs[0]).not.toBeNull();
      for (const r of runs) expect(r).toEqual(runs[0]);
    });

    it("does not cycle even when preferPrefix is not given", () => {
      // The ResultsPreview path is what the user sees — it calls
      // findPathForWord with no prefer on every highlight. Two rapid
      // calls must yield identical arrays (no cell/index perturbation).
      const b = [
        "C", "A", "T", "C",
        "A", "T", "S", "A",
        "T", "S", "C", "T",
        "S", "C", "A", "T",
      ];
      const a = findPathForWord(b, "cats");
      const b2 = findPathForWord(b, "cats");
      expect(a).not.toBeNull();
      expect(b2).toEqual(a);
    });
  });
});
