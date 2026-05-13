// Reconcile the curated denylist.txt and allowlist.txt against the
// shipped words/defs/inflections data. Idempotent — re-run any time you
// edit either list so the in-repo data files stay consistent with them
// without having to run the full 3GB Wiktionary build.
//
//   tsx scripts/apply-denylist.ts
//   # or: pnpm denylist:apply / pnpm dict:reconcile
//
// Behavior:
//   - denylist.txt entries are removed from words.txt, definitions.json,
//     and inflections.json. Inflections whose lemma is denylisted are
//     dropped too, keeping lookups consistent.
//   - allowlist.txt entries are added to words.txt (unless they are also
//     on the denylist). Definitions are left alone — if Wiktionary had
//     one, it stays; otherwise the tooltip API returns "no definition
//     available", which is acceptable for closed-class words.
//
// The tests/server/dictionary.test.ts > "no denylisted word leaks"
// invariant enforces denylist correctness in CI.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "data/dictionary";

interface DefEntry {
  pos: string;
  def: string;
}

const words = new Set(
  readFileSync(`${DIR}/words.txt`, "utf8").split(/\r?\n/).filter(Boolean)
);
const defs = JSON.parse(
  readFileSync(`${DIR}/definitions.json`, "utf8")
) as Record<string, DefEntry[]>;
const infl = JSON.parse(
  readFileSync(`${DIR}/inflections.json`, "utf8")
) as Record<string, string>;

function loadList(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim().toLowerCase())
      .filter((l) => /^[a-z]+$/.test(l) && l.length >= 3)
  );
}

const deny = loadList(`${DIR}/denylist.txt`);
const allow = loadList(`${DIR}/allowlist.txt`);

// Deny wins if a word somehow appears in both — safer default.
for (const w of deny) allow.delete(w);

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

let added = 0;
for (const w of allow) {
  if (!words.has(w)) {
    words.add(w);
    added++;
  }
}

writeFileSync(`${DIR}/words.txt`, [...words].sort().join("\n") + "\n");
writeFileSync(`${DIR}/definitions.json`, JSON.stringify(defs));
writeFileSync(`${DIR}/inflections.json`, JSON.stringify(infl));

console.log(`denylist entries:  ${deny.size}`);
console.log(`allowlist entries: ${allow.size}`);
console.log(`removed from words.txt:    ${rw}`);
console.log(`removed from defs:         ${rd}`);
console.log(`removed from inflections:  ${ri}`);
console.log(`orphaned inflection words: ${orphan}`);
console.log(`added from allowlist:      ${added}`);
console.log(
  `final counts: words=${words.size} defs=${Object.keys(defs).length} infl=${Object.keys(infl).length}`
);
