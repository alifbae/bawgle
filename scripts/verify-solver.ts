/**
 * Solver verifier / inspector.
 *
 * Default behavior (no args) runs a sanity check across sizes 4/5/6 —
 * rolls a board, solves it, spot-checks that the solver's words are
 * actually reachable on the board.
 *
 * Flags let you inspect a single board interactively and eyeball the
 * output. Useful after dictionary edits: "what would players see on a
 * random board after my changes?"
 *
 *   pnpm exec tsx scripts/verify-solver.ts                       # default sweep
 *   pnpm exec tsx scripts/verify-solver.ts --size=5              # one random 5x5
 *   pnpm exec tsx scripts/verify-solver.ts --size=4 --seed=42    # reproducible
 *   pnpm exec tsx scripts/verify-solver.ts --board="C,A,T,S,..." # specific board
 *   pnpm exec tsx scripts/verify-solver.ts --defs                # include tooltip
 *   pnpm exec tsx scripts/verify-solver.ts --limit=0             # show all words
 *   pnpm exec tsx scripts/verify-solver.ts --min-length=5        # filter short
 *   pnpm exec tsx scripts/verify-solver.ts --sort=score          # length|alpha|score
 */
import { rollBoard, wordPathExists } from "../shared/board.ts";
import { loadDictionary, solveBoard, lookupDefinition } from "../server/dictionary.ts";
import { scoreWord } from "../shared/types.ts";

interface Args {
  size?: 4 | 5 | 6;
  seed?: number;
  board?: string[];
  defs: boolean;
  limit: number;
  minLength: number;
  sort: "length" | "alpha" | "score";
  stress?: number;
  stressLength?: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    defs: false,
    limit: 50,
    minLength: 3,
    sort: "length",
  };
  for (const a of argv) {
    if (a === "--defs") out.defs = true;
    else if (a.startsWith("--size=")) {
      const n = Number(a.slice(7));
      if (![4, 5, 6].includes(n)) throw new Error(`bad --size, want 4|5|6`);
      out.size = n as 4 | 5 | 6;
    } else if (a.startsWith("--seed=")) {
      const n = Number(a.slice(7));
      if (!Number.isFinite(n)) throw new Error(`bad --seed`);
      out.seed = n;
    } else if (a.startsWith("--board=")) {
      const raw = a.slice(8);
      out.board = raw
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
    } else if (a.startsWith("--limit=")) {
      out.limit = Number(a.slice(8));
    } else if (a.startsWith("--min-length=")) {
      out.minLength = Number(a.slice(13));
    } else if (a.startsWith("--sort=")) {
      const s = a.slice(7);
      if (!["length", "alpha", "score"].includes(s)) {
        throw new Error(`bad --sort, want length|alpha|score`);
      }
      out.sort = s as Args["sort"];
    } else if (a.startsWith("--stress=")) {
      out.stress = Number(a.slice(9));
      if (!Number.isInteger(out.stress) || out.stress <= 0) {
        throw new Error(`bad --stress, want positive integer`);
      }
    } else if (a.startsWith("--stress-length=")) {
      out.stressLength = Number(a.slice(16));
      if (!Number.isInteger(out.stressLength) || out.stressLength < 3) {
        throw new Error(`bad --stress-length, want integer >= 3`);
      }
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`verify-solver — inspect the Boggle solver

Usage:
  tsx scripts/verify-solver.ts                   default sweep (4/5/6)
  tsx scripts/verify-solver.ts --size=N          roll one NxN board
  tsx scripts/verify-solver.ts --board="A,B,..." solve a specific board

Flags:
  --size=4|5|6        board size to roll (default: sweep all three)
  --seed=N            RNG seed for reproducibility (only used with --size)
  --board="a,b,c,..." explicit board faces, comma-separated, row-major
  --defs              include first definition / inflection lemma
  --limit=N           max words to print (0 = all). Default 50
  --min-length=N      filter out words shorter than N (default 3)
  --sort=length|alpha|score
  --stress=N          solve N random boards at --size, aggregate word freqs
  --stress-length=N   stress-only: filter to words of this exact length (default 3)
  -h, --help
`);
}

/**
 * Mulberry32 — cheap deterministic PRNG. Swapped onto Math.random so
 * rollBoard becomes reproducible under --seed.
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inspectBoard(board: string[], size: 4 | 5 | 6, args: Args): void {
  const t0 = Date.now();
  const solved = solveBoard(board, size);
  const ms = Date.now() - t0;

  const filtered = solved.filter((w) => {
    const len = w.replace(/qu/g, "q").length; // treat Qu as 1 char for length
    return len >= args.minLength;
  });

  const comparator = (a: string, b: string): number => {
    if (args.sort === "length") return a.length - b.length || a.localeCompare(b);
    if (args.sort === "alpha") return a.localeCompare(b);
    return scoreWord(b) - scoreWord(a) || a.localeCompare(b); // score desc
  };
  const sorted = [...filtered].sort(comparator);

  // Header: visual board + stats
  console.log(renderBoard(board, size));
  const sampleSize = Math.min(50, filtered.length);
  let unreachable = 0;
  for (const w of filtered.slice(0, sampleSize)) {
    if (!wordPathExists(board, w, size)) unreachable++;
  }
  console.log(
    `\nsize=${size}x${size}  total=${solved.length}  ` +
      `after-filter=${filtered.length}  solve=${ms}ms  ` +
      `sampled=${sampleSize}, unreachable=${unreachable}`
  );
  if (unreachable > 0) {
    console.log(
      `  WARN solver returned ${unreachable} words that can't be traced on this board`
    );
  }

  const shown = args.limit === 0 ? sorted : sorted.slice(0, args.limit);
  console.log(
    `\n--- showing ${shown.length} of ${filtered.length} (sort=${args.sort}) ---\n`
  );

  for (const w of shown) {
    const score = scoreWord(w);
    if (args.defs) {
      const d = lookupDefinition(w);
      const tag = d?.defs?.[0]
        ? `[${d.defs[0].pos}] ${d.defs[0].def.slice(0, 80)}${
            d.lemma ? ` (via ${d.lemma})` : ""
          }`
        : "(no def)";
      console.log(`  ${w.padEnd(14)} +${score}  ${tag}`);
    } else {
      console.log(`  ${w.padEnd(14)} +${score}`);
    }
  }

  if (args.limit && filtered.length > args.limit) {
    console.log(
      `\n... and ${filtered.length - args.limit} more. Use --limit=0 to see all.`
    );
  }
}

/** ASCII render of the board. Handles "Qu" tiles for 4x4. */
function renderBoard(board: string[], size: number): string {
  const rows: string[] = [];
  for (let r = 0; r < size; r++) {
    const cells = board
      .slice(r * size, (r + 1) * size)
      .map((c) => c.toUpperCase().padStart(2, " "));
    rows.push("  " + cells.join("  "));
  }
  return rows.join("\n");
}

/**
 * Solve `count` random boards at the given size and aggregate which words
 * (of the target length) appear across runs. Purpose: surface suspect
 * entries (mostly 3-letter garbage) that slip past every other filter but
 * are common enough to show up often in real play.
 *
 * Words covered by definitions.json or resolvable via inflections.json
 * are considered "explained" — the unexplained ones (no tooltip at all)
 * are the prime candidates for the denylist.
 */
function runStress(
  size: 4 | 5 | 6,
  count: number,
  targetLen: number,
  seed?: number,
): void {
  const originalRandom = Math.random;
  if (seed !== undefined) Math.random = seededRandom(seed);

  const freq = new Map<string, number>();
  const t0 = Date.now();
  let totalSolved = 0;
  for (let i = 0; i < count; i++) {
    const board = rollBoard(size);
    const solved = solveBoard(board, size);
    totalSolved += solved.length;
    for (const w of solved) {
      const effectiveLen = w.replace(/qu/g, "q").length;
      if (effectiveLen !== targetLen) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  Math.random = originalRandom;
  const ms = Date.now() - t0;

  const sorted = [...freq.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  console.log(
    `stress: ${count} boards at ${size}x${size}, ` +
      `${totalSolved.toLocaleString()} words total, ${ms}ms`,
  );
  console.log(`distinct ${targetLen}-letter words seen: ${sorted.length}`);

  const covered = sorted.filter(([w]) => lookupDefinition(w) !== null);
  const suspect = sorted.filter(([w]) => lookupDefinition(w) === null);
  console.log(`  covered (has def or resolves via inflection): ${covered.length}`);
  console.log(`  suspect (no tooltip — candidates for denylist):  ${suspect.length}\n`);

  console.log(`=== suspect ${targetLen}-letter words, by frequency ===\n`);
  const pad = Math.max(6, targetLen + 2);
  for (const [w, n] of suspect) {
    const bar = "#".repeat(Math.min(40, n));
    console.log(`  ${w.padEnd(pad)} ${String(n).padStart(4)}  ${bar}`);
  }

  if (!suspect.length) return;

  console.log(
    `\nreview the list above. Any that shouldn't count go into ` +
      `data/dictionary/denylist.txt (one per line).`,
  );
  const copyable = suspect.map(([w]) => w).join("\n");
  console.log(`\n--- copyable, one per line ---\n${copyable}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  loadDictionary();
  console.log("");

  if (args.stress) {
    const size = args.size ?? 4;
    const targetLen = args.stressLength ?? 3;
    runStress(size, args.stress, targetLen, args.seed);
    return;
  }

  // --board wins over --size
  if (args.board) {
    const n = args.board.length;
    const size = Math.round(Math.sqrt(n));
    if (size * size !== n || ![4, 5, 6].includes(size)) {
      console.error(`--board has ${n} faces; must be 16, 25, or 36`);
      process.exit(1);
    }
    inspectBoard(args.board, size as 4 | 5 | 6, args);
    return;
  }

  if (args.size) {
    // Seeded board requires patching Math.random since rollBoard uses it.
    const originalRandom = Math.random;
    if (args.seed !== undefined) Math.random = seededRandom(args.seed);
    const board = rollBoard(args.size);
    Math.random = originalRandom;
    inspectBoard(board, args.size, args);
    return;
  }

  // Default: sweep across sizes, quick summary (preserves original behavior).
  for (const size of [4, 5, 6] as const) {
    const t0 = Date.now();
    const board = rollBoard(size);
    const solved = solveBoard(board, size);
    const ms = Date.now() - t0;
    console.log(
      `size=${size}x${size}  cells=${board.length}  words=${solved.length}  time=${ms}ms`
    );
    const sample = solved.slice(0, 50);
    let bad = 0;
    for (const w of sample) if (!wordPathExists(board, w, size)) bad++;
    console.log(`  sampled ${sample.length}, unresolvable paths=${bad}`);
    console.log(`  board: ${board.join(" ")}`);
    console.log(`  last 10: ${solved.slice(-10).join(", ")}\n`);
  }
  console.log(
    "tip: rerun with --size=N to inspect a single board, --defs for tooltips, --seed=N for reproducibility."
  );
}

main();
