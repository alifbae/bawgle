import { describe, expect, it } from "vitest";
import { scoreWord } from "../../shared/types.ts";

describe("scoreWord", () => {
  it("returns 0 for words shorter than 3 letters", () => {
    expect(scoreWord("")).toBe(0);
    expect(scoreWord("a")).toBe(0);
    expect(scoreWord("ab")).toBe(0);
  });

  it("awards length-minus-two for valid words", () => {
    expect(scoreWord("cat")).toBe(1);
    expect(scoreWord("cats")).toBe(2);
    expect(scoreWord("octopus")).toBe(5);
  });

  it("does not care about the qu digraph — scoring is purely length-based", () => {
    // `submitWord` is the gate for content; scoring just sees chars.
    expect(scoreWord("queen")).toBe(3);
    expect(scoreWord("quiz")).toBe(2);
  });
});
