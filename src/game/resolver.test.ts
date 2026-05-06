import { beforeEach, describe, expect, it } from "vitest";
import { setBoardSize } from "./path.ts";
import { findPathForWord } from "./resolver.ts";

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
    const letters = path!.map((i) => board[i]).join("");
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
});
