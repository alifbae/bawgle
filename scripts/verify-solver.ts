/**
 * Quick sanity check for the solver across grid sizes.
 * Run with: pnpm --filter boggle exec tsx scripts/verify-solver.ts
 */
import { rollBoard, wordPathExists } from "../shared/board.ts";
import { loadDictionary, solveBoard } from "../server/dictionary.ts";

loadDictionary();

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
  for (const w of sample) {
    if (!wordPathExists(board, w, size)) bad++;
  }
  console.log(`  sampled ${sample.length}, unresolvable paths=${bad}`);
  console.log(`  board: ${board.join(" ")}`);
  console.log(`  last 10: ${solved.slice(-10).join(", ")}`);
}
