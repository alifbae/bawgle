// Apply the current denylist.txt to the shipped words/defs/inflections
// data. Idempotent — re-run any time denylist.txt changes so the
// in-repo data files stay consistent with it.
//
//   node scripts/apply-denylist.mjs
//
// Existing tests/server/dictionary.test.ts > "no denylisted word leaks"
// enforces this invariant in CI, so you'll know if you forgot.

import { readFileSync, writeFileSync } from "node:fs";

const DIR = "data/dictionary";

const words = new Set(
  readFileSync(`${DIR}/words.txt`, "utf8").split(/\r?\n/).filter(Boolean),
);
const defs = JSON.parse(readFileSync(`${DIR}/definitions.json`, "utf8"));
const infl = JSON.parse(readFileSync(`${DIR}/inflections.json`, "utf8"));

const deny = new Set(
  readFileSync(`${DIR}/denylist.txt`, "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim().toLowerCase())
    .filter((l) => /^[a-z]+$/.test(l)),
);

let rw = 0;
let rd = 0;
let ri = 0;

for (const w of deny) {
  if (words.delete(w)) rw++;
  if (defs[w]) {
    delete defs[w];
    rd++;
  }
  if (infl[w]) {
    delete infl[w];
    ri++;
  }
}

// Drop inflections whose lemma is denylisted — keeps lookups consistent.
let orphan = 0;
for (const [w, l] of Object.entries(infl)) {
  if (deny.has(l)) {
    delete infl[w];
    if (words.delete(w)) orphan++;
  }
}

writeFileSync(`${DIR}/words.txt`, [...words].sort().join("\n") + "\n");
writeFileSync(`${DIR}/definitions.json`, JSON.stringify(defs));
writeFileSync(`${DIR}/inflections.json`, JSON.stringify(infl));

console.log(`denylist entries: ${deny.size}`);
console.log(`removed from words.txt:   ${rw}`);
console.log(`removed from defs:        ${rd}`);
console.log(`removed from inflections: ${ri}`);
console.log(`orphaned inflection words:${orphan}`);
console.log(
  `final counts: words=${words.size} defs=${Object.keys(defs).length} infl=${Object.keys(infl).length}`,
);
