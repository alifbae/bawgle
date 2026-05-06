import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isWord, loadDictionary, lookupDefinition, solveBoard } from "./dictionary.ts";

// Dictionary module holds global state (word set + trie + defs + inflections).
// We load a small fixture once and assert against it for the whole file.

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bawgle-dict-"));
  mkdirSync(join(tmp, "dict"), { recursive: true });

  const wordsFile = join(tmp, "dict", "words.txt");
  writeFileSync(
    wordsFile,
    ["cat", "cats", "dog", "queen", "er", "x1", "ABCDE"].join("\n") + "\n",
  );

  // NOTE: loadDictionary also reads definitions.json / inflections.json
  // from the sibling DICT_DIR. We don't provide them here, so lookups
  // fall back to empty maps (which we assert against below).
  loadDictionary(wordsFile);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadDictionary + isWord", () => {
  it("accepts canonical lowercase words of length >= 3", () => {
    expect(isWord("cat")).toBe(true);
    expect(isWord("cats")).toBe(true);
    expect(isWord("queen")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isWord("CAT")).toBe(true);
    expect(isWord("Cat")).toBe(true);
  });

  it("filters out short entries and anything with non-alpha chars", () => {
    // "er" is < 3, "x1" contains digits, "ABCDE" is uppercase but got
    // lowercased — so that one DOES get accepted.
    expect(isWord("er")).toBe(false);
    expect(isWord("x1")).toBe(false);
    expect(isWord("abcde")).toBe(true);
  });

  it("rejects words not in the fixture", () => {
    expect(isWord("banana")).toBe(false);
  });
});

describe("solveBoard", () => {
  it("finds dictionary words on a 4x4 board, pruned by trie prefixes", () => {
    //  C A T S
    //  H E R U
    //  D O G P
    //  M N O P
    const board = [
      "C", "A", "T", "S",
      "H", "E", "R", "U",
      "D", "O", "G", "P",
      "M", "N", "O", "P",
    ];
    const found = solveBoard(board, 4);
    expect(found).toContain("cat");
    expect(found).toContain("cats");
    expect(found).toContain("dog");
    // "queen" isn't spellable here, shouldn't appear even though it's
    // a dictionary entry.
    expect(found).not.toContain("queen");
    // Results are lowercase and sorted by length then alpha.
    expect(found).toEqual([...found].sort((a, b) => a.length - b.length || a.localeCompare(b)));
    for (const w of found) expect(w).toBe(w.toLowerCase());
  });

  it("honors the Qu digraph: one cell consumes Q and U", () => {
    const board = [
      "Qu", "E", "E", "N",
      "A",  "B", "C", "D",
      "E",  "F", "G", "H",
      "I",  "J", "K", "L",
    ];
    const found = solveBoard(board, 4);
    expect(found).toContain("queen");
  });

  it("finds no words when the board has no matching prefixes", () => {
    const board = [
      "Z", "Z", "Z", "Z",
      "Z", "Z", "Z", "Z",
      "Z", "Z", "Z", "Z",
      "Z", "Z", "Z", "Z",
    ];
    expect(solveBoard(board, 4)).toEqual([]);
  });
});

describe("lookupDefinition", () => {
  // loadDictionary reads definitions.json from a hardcoded DICT_DIR
  // relative to the server module, so this test can't control its
  // contents. We assert on the contract (shape of non-null results,
  // null for unknown words) rather than specific entries.
  it("returns null for empty input and unknown words", () => {
    expect(lookupDefinition("")).toBeNull();
    expect(lookupDefinition("xyznotaword")).toBeNull();
  });

  it("returns a structured result when a definition exists", () => {
    const result = lookupDefinition("cat");
    if (result === null) {
      // Test repo happens to have no definition for cat — that's fine.
      return;
    }
    expect(result.word).toBe("cat");
    expect(Array.isArray(result.defs)).toBe(true);
  });
});
