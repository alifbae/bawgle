import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
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
    ["cat", "cats", "dog", "queen", "er", "x1", "ABCDE"].join("\n") + "\n"
  );

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
      "C",
      "A",
      "T",
      "S",
      "H",
      "E",
      "R",
      "U",
      "D",
      "O",
      "G",
      "P",
      "M",
      "N",
      "O",
      "P",
    ];
    const found = solveBoard(board, 4);
    expect(found).toContain("cat");
    expect(found).toContain("cats");
    expect(found).toContain("dog");
    // "queen" isn't spellable here, shouldn't appear even though it's
    // a dictionary entry.
    expect(found).not.toContain("queen");
    // Results are lowercase and sorted by length then alpha.
    expect(found).toEqual(
      [...found].sort((a, b) => a.length - b.length || a.localeCompare(b))
    );
    for (const w of found) expect(w).toBe(w.toLowerCase());
  });

  it("honors the Qu digraph: one cell consumes Q and U", () => {
    const board = [
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
    const found = solveBoard(board, 4);
    expect(found).toContain("queen");
  });

  it("finds no words when the board has no matching prefixes", () => {
    const board = [
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
      "Z",
    ];
    expect(solveBoard(board, 4)).toEqual([]);
  });
});

describe("lookupDefinition", () => {
  it("returns null for empty input", () => {
    expect(lookupDefinition("")).toBeNull();
    expect(lookupDefinition("   ")).toBeNull();
  });

  it("returns null for unknown words", () => {
    expect(lookupDefinition("xyznotaword")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reference-style sense filtering
//
// The production dictionary build strips senses whose gloss begins with a
// reference pointer — "Clipping of X", "Misspelling of X", "Obsolete form
// of Y", etc. — because they make misleading tooltips (women → "Misspelling
// of woman" is worse than no tooltip at all).
//
// Three invariants need to hold after filtering:
//   1. No gloss starting with a reference pattern survives in the shipped
//      definitions.json.
//   2. A word whose only senses were reference-style must NOT leak a
//      tooltip (lookupDefinition returns null) but MAY still be in
//      words.txt — a missing tooltip is fine, a wrong one isn't.
//   3. A word with at least one non-reference sense keeps it, cleanly.
//
// These tests drive the filter contract with a hand-built fixture covering
// every category we've seen in the wild. The real data files are exercised
// by the final "shipped dictionary" invariant check below.
// ---------------------------------------------------------------------------

describe("reference-style sense filtering (fixture)", () => {
  let refTmp: string;

  beforeAll(() => {
    refTmp = mkdtempSync(join(tmpdir(), "bawgle-refdict-"));
    mkdirSync(join(refTmp, "dict"), { recursive: true });

    // Words that should all be playable.
    const playable = [
      "real", // clean dictionary word, no reference sense
      "women", // reference-only (misspelling of woman)
      "blew", // reference-only (obsolete form of blue)
      "brassiere", // reference-only (dated form of bra)
      "amid", // reference-only (archaic form of amide)
      "fella", // reference-only (pronunciation spelling of fellow)
      "yeah", // reference-only (pronunciation spelling of year)
      "alot", // reference-only (misspelling of allot)
      "pos", // reference-only (clipping of positive)
      "olde", // reference-only (archaic spelling)
      "koran", // reference-only (dated spelling)
      "berlin", // reference-only (short for)
      "mixed", // has reference + non-reference senses
      "lemma", // target of inflections below
    ];
    writeFileSync(join(refTmp, "dict", "words.txt"), playable.join("\n") + "\n");

    // Definitions file reflects what the build script would produce
    // AFTER the reference-style filter has run:
    //   - "women", "blew", "brassiere", ... : NOT present (only senses were
    //     reference-style, so all stripped → word stays playable but no def)
    //   - "real": present with real senses
    //   - "mixed": present with only the surviving non-reference sense
    //   - "lemma": present, targeted by inflection map
    writeFileSync(
      join(refTmp, "dict", "definitions.json"),
      JSON.stringify({
        real: [{ pos: "noun", def: "An actually existing thing." }],
        mixed: [{ pos: "noun", def: "A blend of two things." }],
        lemma: [{ pos: "noun", def: "A base form of a word." }],
      })
    );

    writeFileSync(
      join(refTmp, "dict", "inflections.json"),
      JSON.stringify({
        lemmas: "lemma", // normal inflection -> real lemma
        lemmae: "lemma", // another inflected form
        orphan: "ghost", // lemma not in defs — lookup should return null
      })
    );

    loadDictionary(join(refTmp, "dict", "words.txt"));
  });

  afterAll(() => {
    rmSync(refTmp, { recursive: true, force: true });
    // Restore the module to the outer fixture so later test files aren't
    // polluted. The outer beforeAll state is what the first suites expect.
    loadDictionary(join(tmp, "dict", "words.txt"));
  });

  describe("words stay playable even without a definition", () => {
    // These all had only reference-style senses and were stripped. They
    // must still count as valid Boggle plays — a missing tooltip is the
    // only downside.
    it.each([
      ["women"],
      ["blew"],
      ["brassiere"],
      ["amid"],
      ["fella"],
      ["yeah"],
      ["alot"],
      ["pos"],
      ["olde"],
      ["koran"],
      ["berlin"],
    ])("isWord(%s) -> true", (word) => {
      expect(isWord(word)).toBe(true);
    });

    it.each([
      ["women"],
      ["blew"],
      ["brassiere"],
      ["amid"],
      ["fella"],
      ["yeah"],
      ["alot"],
      ["pos"],
      ["olde"],
      ["koran"],
      ["berlin"],
    ])("lookupDefinition(%s) -> null (no misleading tooltip)", (word) => {
      expect(lookupDefinition(word)).toBeNull();
    });
  });

  describe("clean words retain their definitions", () => {
    it("returns the sense for a plain word", () => {
      const r = lookupDefinition("real");
      expect(r).not.toBeNull();
      expect(r!.word).toBe("real");
      expect(r!.lemma).toBeNull();
      expect(r!.defs[0].def).toBe("An actually existing thing.");
    });

    it("returns only the non-reference sense for mixed entries", () => {
      const r = lookupDefinition("mixed");
      expect(r).not.toBeNull();
      expect(r!.defs).toHaveLength(1);
      expect(r!.defs[0].def).toBe("A blend of two things.");
      // The reference-style sense should not have leaked through.
      expect(
        r!.defs.some((d) =>
          /^(clipping|misspelling|obsolete|archaic|dated|short for|eye dialect|pronunciation spelling|alternative|initialism|abbreviation|acronym) /i.test(
            d.def
          )
        )
      ).toBe(false);
    });
  });

  describe("inflection passthrough", () => {
    it("resolves an inflected form to its lemma's definition", () => {
      const r = lookupDefinition("lemmas");
      expect(r).not.toBeNull();
      expect(r!.word).toBe("lemmas");
      expect(r!.lemma).toBe("lemma");
      expect(r!.defs[0].def).toBe("A base form of a word.");
    });

    it("is case-insensitive on the inflected input", () => {
      const r = lookupDefinition("LEMMAE");
      expect(r).not.toBeNull();
      expect(r!.lemma).toBe("lemma");
    });

    it("returns null when the inflection points at a stripped/missing lemma", () => {
      // "orphan" -> "ghost", but "ghost" isn't in definitions.json.
      // Tooltip should silently fall through, not throw.
      expect(lookupDefinition("orphan")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Shipped dictionary invariant check
//
// This is the regression-safety net: the actual production files MUST NOT
// contain any reference-style gloss for any word. If someone reruns the
// Wiktionary build without the filter and commits the output, this test
// fails loudly.
// ---------------------------------------------------------------------------

describe("shipped definitions.json invariants", () => {
  const defsPath = join(process.cwd(), "data", "dictionary", "definitions.json");
  const wordsPath = join(process.cwd(), "data", "dictionary", "words.txt");
  const denyPath = join(process.cwd(), "data", "dictionary", "denylist.txt");

  // Mirrors the filter in scripts/build-dictionary.ts.
  const REFERENCE_GLOSS =
    /^(?:short for\b|(?:initialism|abbreviation|acronym|clipping|alternative (?:letter-case )?form|alternative spelling|misspelling|(?:eye dialect|informal|nonstandard|elongated) (?:spelling|form)|pronunciation spelling|(?:obsolete|archaic|dated) (?:form|spelling)) of\b)/i;

  it("contains no reference-style glosses", () => {
    const defs = JSON.parse(readFileSync(defsPath, "utf8")) as Record<
      string,
      { pos: string; def: string }[]
    >;
    const offenders: string[] = [];
    for (const [word, senses] of Object.entries(defs)) {
      for (const s of senses) {
        if (REFERENCE_GLOSS.test(s.def)) {
          offenders.push(`${word}: ${s.def}`);
          if (offenders.length >= 5) break;
        }
      }
      if (offenders.length >= 5) break;
    }
    expect(offenders, offenders.slice(0, 5).join("\n")).toHaveLength(0);
  });

  it("every definitions.json key is present in words.txt", () => {
    const defs = JSON.parse(readFileSync(defsPath, "utf8")) as Record<string, unknown>;
    const words = new Set(
      readFileSync(wordsPath, "utf8")
        .split(/\r?\n/)
        .map((w) => w.trim())
        .filter(Boolean)
    );
    const missing = Object.keys(defs).filter((w) => !words.has(w));
    expect(missing, missing.slice(0, 10).join(", ")).toHaveLength(0);
  });

  it("no denylisted word leaks into words.txt, definitions.json, or inflections.json", () => {
    const words = new Set(
      readFileSync(wordsPath, "utf8")
        .split(/\r?\n/)
        .map((w) => w.trim())
        .filter(Boolean)
    );
    const defs = JSON.parse(readFileSync(defsPath, "utf8")) as Record<string, unknown>;
    const inflPath = join(process.cwd(), "data", "dictionary", "inflections.json");
    const infl = JSON.parse(readFileSync(inflPath, "utf8")) as Record<string, string>;
    const deny = readFileSync(denyPath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim().toLowerCase())
      .filter((l) => /^[a-z]+$/.test(l));

    const leaks: string[] = [];
    for (const w of deny) {
      if (words.has(w)) leaks.push(`${w} in words.txt`);
      if (defs[w]) leaks.push(`${w} in definitions.json`);
      if (infl[w]) leaks.push(`${w} in inflections.json`);
    }
    expect(leaks, leaks.slice(0, 10).join("\n")).toHaveLength(0);
  });
});
