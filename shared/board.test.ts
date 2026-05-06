import { describe, expect, it } from "vitest";
import { rollBoard, wordPathExists } from "./board.ts";

describe("rollBoard", () => {
  it("produces the right number of cells per size", () => {
    expect(rollBoard(4)).toHaveLength(16);
    expect(rollBoard(5)).toHaveLength(25);
    expect(rollBoard(6)).toHaveLength(36);
  });

  it("represents a Q-die face as the Qu digraph", () => {
    // Seed RNG by running the roll enough times to hit the Q face at
    // least once across the runs. Deterministic search on the 4x4 dice,
    // one of which is "HIMNUQ".
    let sawQu = false;
    for (let i = 0; i < 200 && !sawQu; i++) {
      const b = rollBoard(4);
      if (b.includes("Qu")) sawQu = true;
      for (const c of b) {
        // Every cell is either a single uppercase letter or the Qu digraph.
        expect(c === "Qu" || /^[A-Z]$/.test(c)).toBe(true);
      }
    }
    expect(sawQu).toBe(true);
  });

  it("throws on unsupported sizes", () => {
    expect(() => rollBoard(3 as unknown as 4)).toThrow(/unsupported/);
  });
});

describe("wordPathExists", () => {
  // Hand-rolled 4x4 so assertions are deterministic.
  //  C A T S
  //  H E R U
  //  P O L I
  //  D N E G
  const board4 = [
    "C", "A", "T", "S",
    "H", "E", "R", "U",
    "P", "O", "L", "I",
    "D", "N", "E", "G",
  ];

  it("finds straight horizontal paths", () => {
    expect(wordPathExists(board4, "CATS", 4)).toBe(true);
  });

  it("finds diagonal paths", () => {
    // C(0) → E(5) → R(6) → L(10) — diagonal/orthogonal chain.
    expect(wordPathExists(board4, "CERL", 4)).toBe(true);
  });

  it("rejects words that skip non-adjacent cells", () => {
    // C(0) and S(3) are not adjacent.
    expect(wordPathExists(board4, "CS", 4)).toBe(false);
  });

  it("rejects words that would require reusing a cell", () => {
    // Only one A; "AAA" is impossible.
    expect(wordPathExists(board4, "AAA", 4)).toBe(false);
  });

  it("treats input case-insensitively", () => {
    expect(wordPathExists(board4, "cats", 4)).toBe(true);
    expect(wordPathExists(board4, "CaTs", 4)).toBe(true);
  });

  it("handles the Qu digraph: one board cell consumes both Q and U", () => {
    //  Qu E  E N
    //   A  B C D
    //   E  F G H
    //   I  J K L
    const qBoard = [
      "Qu", "E", "E", "N",
      "A", "B", "C", "D",
      "E", "F", "G", "H",
      "I", "J", "K", "L",
    ];
    expect(wordPathExists(qBoard, "QUEEN", 4)).toBe(true);
    // QE alone still starts at Qu cell, adjacency to E at index 1 is fine.
    expect(wordPathExists(qBoard, "QUE", 4)).toBe(true);
  });

  it("supports 5x5 boards", () => {
    // prettier-ignore
    const board5 = [
      "A","B","C","D","E",
      "F","G","H","I","J",
      "K","L","M","N","O",
      "P","Q","R","S","T",
      "U","V","W","X","Y",
    ];
    // A(0) → G(6) → M(12) → S(18) → Y(24): diagonal.
    expect(wordPathExists(board5, "AGMSY", 5)).toBe(true);
    // A(0) → Y(24) directly: not adjacent.
    expect(wordPathExists(board5, "AY", 5)).toBe(false);
  });
});
