import { describe, expect, it } from "vitest";
import { buildShareText } from "../../../src/client/lib/util/share-text.ts";
import type { Player, RoomState } from "../../../src/shared/types.ts";

function mkPlayer(name: string, score: number): Player {
  return {
    id: `id-${name}`,
    clientId: `c-${name}`,
    name,
    connected: false,
    ready: false,
    score,
    words: [],
  };
}

function mkState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: "ABC1",
    phase: "results",
    board: null,
    endsAt: null,
    startsAt: null,
    players: [],
    hostId: null,
    settings: { roundSeconds: 180, size: 4 },
    possibleCount: 0,
    possibleWords: [],
    lastRoundId: null,
    ...overrides,
  };
}

describe("buildShareText", () => {
  const URL = "https://bawgle.example.com/result?round=42";

  it("returns the URL alone when state has no players", () => {
    expect(buildShareText(mkState(), URL)).toBe(URL);
  });

  it("returns the URL alone when state is null", () => {
    expect(buildShareText(null, URL)).toBe(URL);
  });

  it("includes crown, scoreboard, and url on one line", () => {
    const state = mkState({
      players: [mkPlayer("ALFA", 30), mkPlayer("BETA", 22), mkPlayer("GAMA", 10)],
    });
    const out = buildShareText(state, URL);
    expect(out).toBe(`bawgle - 👑 ALFA (30), BETA (22), GAMA (10) ${URL}`);
    expect(out.split("\n")).toHaveLength(1);
  });

  it("sorts players by score descending", () => {
    const state = mkState({
      players: [mkPlayer("LAST", 5), mkPlayer("FIRST", 50), mkPlayer("MID", 20)],
    });
    const out = buildShareText(state, URL);
    expect(out.indexOf("FIRST")).toBeLessThan(out.indexOf("MID"));
    expect(out.indexOf("MID")).toBeLessThan(out.indexOf("LAST"));
  });

  it("suppresses the crown when every player scored zero", () => {
    const state = mkState({
      players: [mkPlayer("AAAA", 0), mkPlayer("BBBB", 0)],
    });
    const out = buildShareText(state, URL);
    expect(out).not.toContain("👑");
  });

  it("breaks name ties alphabetically for stable output", () => {
    const state = mkState({
      players: [mkPlayer("ZETA", 10), mkPlayer("ALFA", 10)],
    });
    const out = buildShareText(state, URL);
    expect(out.indexOf("ALFA")).toBeLessThan(out.indexOf("ZETA"));
    // Only the first (after sort) should carry the crown.
    expect(out.match(/👑/g)?.length ?? 0).toBe(1);
  });
});
