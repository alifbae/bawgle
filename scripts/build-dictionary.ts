/**
 * Build the Bawgle game dictionary and definitions from the kaikki.org
 * extracted Wiktionary dump.
 *
 *   1. Download the English dump (~2.9GB, JSONL one entry per line) into
 *      apps/bawgle/.cache/. Downloads are resumable and cached — running
 *      twice doesn't re-fetch.
 *   2. Stream-parse: keep entries whose POS is noun / verb / adjective /
 *      adverb (rejecting entries whose only POS is abbreviation / proper
 *      noun / symbol / interjection / etc.).
 *   3. Require the word to appear in the subtitle-frequency corpus top-50k
 *      (real everyday usage) so we exclude archaic or Latin-only entries.
 *   4. Union with the existing ENABLE-based 32k dictionary so we don't
 *      regress on words players already expect to work.
 *   5. Write:
 *        apps/bawgle/data/dictionary/words.txt
 *        apps/bawgle/data/dictionary/definitions.json
 *        apps/bawgle/data/dictionary/inflections.json
 *
 * Run: pnpm --filter bawgle exec tsx scripts/build-dictionary.ts
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import https from "node:https";
import { IncomingMessage } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DICT_DIR = join(ROOT, "data", "dictionary");
const CACHE_DIR = join(ROOT, ".cache");
mkdirSync(DICT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const WIKT_URL =
  "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl";
const WIKT_CACHE = join(CACHE_DIR, "kaikki-en.jsonl");

const FREQ_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt";
const FREQ_CACHE = join(CACHE_DIR, "en_50k.txt");

const ENABLE_URL =
  "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt";
const ENABLE_CACHE = join(CACHE_DIR, "enable1.txt");

const DENYLIST_PATH = join(DICT_DIR, "denylist.txt");

const OUT_WORDS = join(DICT_DIR, "words.txt");
const OUT_DEFS = join(DICT_DIR, "definitions.json");
const OUT_INFLECTIONS = join(DICT_DIR, "inflections.json");

// POS categories we accept. A word needs ≥1 sense with one of these.
const ACCEPTED_POS = new Set(["noun", "verb", "adj", "adjective", "adv", "adverb"]);

/** Normalize kaikki's POS strings to a consistent set. */
function normalizePos(raw: string): string {
  const p = (raw || "").toLowerCase();
  if (p === "adj") return "adjective";
  if (p === "adv") return "adverb";
  if (p === "abbrev") return "abbreviation";
  if (p === "propn") return "proper noun";
  return p;
}

interface DefEntry {
  pos: string;
  def: string;
}

// Wiktionary tags many initialisms/acronyms as nouns, so POS alone doesn't
// catch them. The gloss text, however, always opens with one of these
// phrases when the entry is just an abbreviation. Rejecting on gloss keeps
// real multi-sense words (like "ok" tagged as noun+interjection) while
// dropping pure abbreviations.
const ABBREV_GLOSS =
  /^(initialism|abbreviation|acronym|alternative (?:letter-case )?form|alternative spelling) of\b/i;

function isAbbreviationGloss(gloss: string): boolean {
  return ABBREV_GLOSS.test(gloss);
}

/** Download with resume support. */
function download(url: string, dest: string, expectedSize?: number): Promise<void> {
  if (existsSync(dest)) {
    const size = statSync(dest).size;
    if (!expectedSize || size === expectedSize) {
      console.log(`[cache] ${dest} (${formatBytes(size)})`);
      return Promise.resolve();
    }
  }

  return new Promise((resolveP, rejectP) => {
    const req = https.get(url, (res) => {
      handleResponse(res, dest, url, resolveP, rejectP);
    });
    req.on("error", rejectP);
  });
}

function handleResponse(
  res: IncomingMessage,
  dest: string,
  url: string,
  resolveP: () => void,
  rejectP: (err: Error) => void
) {
  if (res.statusCode === 301 || res.statusCode === 302) {
    const loc = res.headers.location;
    if (!loc) {
      rejectP(new Error("redirect without location"));
      return;
    }
    download(loc, dest).then(resolveP, rejectP);
    return;
  }
  if (res.statusCode !== 200) {
    rejectP(new Error(`HTTP ${res.statusCode} for ${url}`));
    return;
  }

  const total = Number(res.headers["content-length"] || 0);
  console.log(`[fetch] ${url}`);
  if (total) console.log(`        ${formatBytes(total)}`);

  let downloaded = 0;
  let lastReported = 0;
  const file = createWriteStream(dest);
  res.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    if (total && downloaded - lastReported > total / 50) {
      process.stdout.write(
        `\r        ${formatBytes(downloaded)} / ${formatBytes(total)}  ` +
          `(${Math.round((downloaded / total) * 100)}%)`
      );
      lastReported = downloaded;
    }
  });
  res.pipe(file);
  file.on("finish", () => {
    process.stdout.write("\n");
    file.close(() => resolveP());
  });
  file.on("error", rejectP);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

async function loadFrequencySet(): Promise<Set<string>> {
  const raw = readFileSync(FREQ_CACHE, "utf8");
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const word = line.split(/\s+/)[0]?.toLowerCase();
    if (!word) continue;
    if (!/^[a-z]+$/.test(word)) continue;
    if (word.length < 3) continue;
    out.add(word);
  }
  return out;
}

async function loadEnableSet(): Promise<Set<string>> {
  const raw = readFileSync(ENABLE_CACHE, "utf8");
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const w = line.trim().toLowerCase();
    if (!w) continue;
    if (!/^[a-z]+$/.test(w)) continue;
    if (w.length < 3) continue;
    out.add(w);
  }
  return out;
}

function loadDenylist(): Set<string> {
  if (!existsSync(DENYLIST_PATH)) return new Set();
  return new Set(
    readFileSync(DENYLIST_PATH, "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim().toLowerCase())
      .filter((l) => /^[a-z]+$/.test(l))
  );
}

/**
 * Stream through the JSONL and collect:
 *   - defsByWord:    Map<word, DefEntry[]>   definitions for lemmas
 *   - inflections:   Map<inflected, lemma>   plurals/past/-ing forms that
 *                                            point at a lemma
 * Applies the "only-reject POS" rule at the end so an entry that is only
 * tagged as initialism/proper-noun/etc. doesn't leak into definitions.
 */
async function readWiktionary(freq: Set<string>): Promise<{
  defs: Map<string, DefEntry[]>;
  inflections: Map<string, string>;
}> {
  const acceptedDefs = new Map<string, DefEntry[]>();
  const inflections = new Map<string, string>();
  const posByWord = new Map<string, Set<string>>();

  const rl = readline.createInterface({
    input: createReadStream(WIKT_CACHE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let seen = 0;
  let kept = 0;
  let inflKept = 0;

  for await (const line of rl) {
    seen++;
    if (!line) continue;

    let rec: {
      word?: string;
      lang_code?: string;
      pos?: string;
      senses?: {
        glosses?: string[];
        tags?: string[];
        form_of?: { word?: string }[];
      }[];
    };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec.lang_code !== "en") continue;
    if (!rec.word || !rec.pos) continue;

    const word = rec.word.toLowerCase();
    if (!/^[a-z]+$/.test(word)) continue;
    if (word.length < 3) continue;
    if (!freq.has(word)) continue;

    const pos = normalizePos(rec.pos);

    if (!posByWord.has(word)) posByWord.set(word, new Set());
    posByWord.get(word)!.add(pos);

    // Collect inflections regardless of POS — plurals of proper nouns are
    // rare and if they slip through, resolver will just skip them.
    for (const sense of rec.senses ?? []) {
      const forms = sense.form_of;
      if (!forms?.length) continue;
      const lemma = forms[0]?.word?.toLowerCase();
      if (!lemma) continue;
      if (!/^[a-z]+$/.test(lemma)) continue;
      if (lemma === word) continue;
      // Don't override if we already mapped this inflection.
      if (!inflections.has(word)) {
        inflections.set(word, lemma);
        inflKept++;
      }
      break;
    }

    if (!ACCEPTED_POS.has(pos)) continue;

    // Take the first concise, non-form-of gloss for this POS.
    for (const sense of rec.senses ?? []) {
      if (sense.form_of?.length) continue; // skip "plural of X" style entries
      const gloss = sense.glosses?.[0];
      if (!gloss) continue;
      const trimmed = gloss.trim();
      if (trimmed.length < 3 || trimmed.length > 240) continue;
      if (isAbbreviationGloss(trimmed)) continue; // skip initialism/acronym defs
      if (!acceptedDefs.has(word)) acceptedDefs.set(word, []);
      const arr = acceptedDefs.get(word)!;
      if (!arr.some((e) => e.pos === pos)) arr.push({ pos, def: trimmed });
      break;
    }

    kept++;
    if (seen % 500_000 === 0) {
      process.stdout.write(
        `\r[wiktionary] scanned ${seen.toLocaleString()} lines, defs ${kept.toLocaleString()}, inflections ${inflKept.toLocaleString()}…`
      );
    }
  }
  process.stdout.write("\n");

  // Enforce "reject words whose only POS is abbreviation/proper-noun/etc."
  for (const [word] of [...acceptedDefs]) {
    const all = posByWord.get(word) ?? new Set();
    const hasAccepted = [...all].some((p) => ACCEPTED_POS.has(p));
    if (!hasAccepted) acceptedDefs.delete(word);
  }

  for (const [word, defs] of acceptedDefs) {
    if (defs.length > 3) acceptedDefs.set(word, defs.slice(0, 3));
  }

  return { defs: acceptedDefs, inflections };
}

async function main() {
  console.log("[bawgle] build-dictionary\n");

  await download(FREQ_URL, FREQ_CACHE);
  await download(ENABLE_URL, ENABLE_CACHE);
  await download(WIKT_URL, WIKT_CACHE);

  console.log("\n[freq] loading frequency corpus…");
  const freq = await loadFrequencySet();
  console.log(`[freq] ${freq.size.toLocaleString()} words`);

  console.log("\n[enable] loading ENABLE Scrabble list…");
  const enable = await loadEnableSet();
  console.log(`[enable] ${enable.size.toLocaleString()} words`);

  const denylist = loadDenylist();
  if (denylist.size) {
    console.log(`[denylist] ${denylist.size} words will be excluded`);
  }

  console.log("\n[wiktionary] parsing…");
  const { defs: wiktionary, inflections } = await readWiktionary(freq);
  console.log(
    `[wiktionary] ${wiktionary.size.toLocaleString()} definitions, ` +
      `${inflections.size.toLocaleString()} inflection mappings`
  );

  // A word earns its place in the final dictionary only if it has proof of
  // being an English word: either a Wiktionary content-POS definition, or
  // an inflection whose lemma has one. Being in ENABLE + frequency alone
  // isn't enough — that lets through acronyms and Scrabble-only garbage
  // like `tts`, `noi`, `sio`, `abc`. This strict filter is the fix.
  const finalWords = new Set<string>();
  const definitions: Record<string, DefEntry[]> = {};
  const inflOut: Record<string, string> = {};

  // Direct-defined words from Wiktionary that also appear in the frequency
  // corpus — includes modern words (meme, selfie) and traditional ones.
  for (const [w, defs] of wiktionary) {
    if (denylist.has(w)) continue;
    finalWords.add(w);
    definitions[w] = defs;
  }
  // Inflected forms from ENABLE whose lemma has a Wiktionary definition.
  for (const [word, lemma] of inflections) {
    if (denylist.has(word)) continue;
    if (denylist.has(lemma)) continue;
    if (!enable.has(word)) continue; // only keep inflections we'd have accepted
    if (!wiktionary.has(lemma)) continue;
    finalWords.add(word);
    if (!definitions[word]) inflOut[word] = lemma;
  }

  const sortedWords = [...finalWords].sort();
  writeFileSync(OUT_WORDS, sortedWords.join("\n") + "\n", "utf8");
  writeFileSync(OUT_DEFS, JSON.stringify(definitions), "utf8");
  writeFileSync(OUT_INFLECTIONS, JSON.stringify(inflOut), "utf8");

  const defCount = Object.keys(definitions).length;
  const inflCount = Object.keys(inflOut).length;
  const covered = defCount + inflCount;
  console.log(
    `\n[done] ${sortedWords.length.toLocaleString()} words total, ` +
      `${covered.toLocaleString()} covered ` +
      `(${defCount.toLocaleString()} direct + ${inflCount.toLocaleString()} via inflection)`
  );
  console.log(`         → ${OUT_WORDS}`);
  console.log(`         → ${OUT_DEFS}`);
  console.log(`         → ${OUT_INFLECTIONS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
