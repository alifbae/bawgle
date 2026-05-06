import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DICT_DIR = join(__dirname, "..", "data", "dictionary");

// Trie node: `end` marks a complete word. Children keyed by single letters.
// For Boggle, we fold the "Qu" die into the trie by treating "qu" as two
// characters during traversal (the die contributes both at once).
interface TrieNode {
  end: boolean;
  kids: Map<string, TrieNode>;
}

export interface WordDefinition {
  pos: string;
  def: string;
}

let words: Set<string> | null = null;
let trie: TrieNode | null = null;
let definitions: Record<string, WordDefinition[]> = {};
let inflections: Record<string, string> = {};

function makeNode(): TrieNode {
  return { end: false, kids: new Map() };
}

function insert(root: TrieNode, word: string) {
  let node = root;
  for (const ch of word) {
    let next = node.kids.get(ch);
    if (!next) {
      next = makeNode();
      node.kids.set(ch, next);
    }
    node = next;
  }
  node.end = true;
}

export function loadDictionary(path?: string) {
  const resolved = path || join(DICT_DIR, "words.txt");
  const dir = dirname(resolved);
  try {
    const raw = readFileSync(resolved, "utf8");
    words = new Set(
      raw
        .split(/\r?\n/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 3 && /^[a-z]+$/.test(w))
    );
    trie = makeNode();
    for (const w of words) insert(trie, w);
    console.log(`[bawgle] loaded ${words.size} words from ${resolved}`);
  } catch (err) {
    console.warn(`[bawgle] dictionary load failed: ${(err as Error).message}`);
    words = new Set();
    trie = makeNode();
  }

  // Definitions + inflection map. Both are optional — if the files aren't
  // present, the tooltip API just says "no definition available". Paths
  // resolve relative to the words.txt file so tests can swap in fixtures.
  const defsPath = join(dir, "definitions.json");
  const inflPath = join(dir, "inflections.json");
  try {
    definitions = JSON.parse(readFileSync(defsPath, "utf8"));
    console.log(`[bawgle] loaded ${Object.keys(definitions).length} definitions`);
  } catch {
    definitions = {};
  }
  try {
    inflections = JSON.parse(readFileSync(inflPath, "utf8"));
    console.log(
      `[bawgle] loaded ${Object.keys(inflections).length} inflection mappings`
    );
  } catch {
    inflections = {};
  }
}

/**
 * Look up definitions for a word. If the word isn't a lemma we resolve
 * through the inflection map (`logs` → `log`) so inflected forms still
 * get a useful tooltip.
 */
export function lookupDefinition(
  raw: string
): { word: string; lemma: string | null; defs: WordDefinition[] } | null {
  const word = raw.toLowerCase().trim();
  if (!word) return null;
  if (definitions[word]) {
    return { word, lemma: null, defs: definitions[word] };
  }
  const lemma = inflections[word];
  if (lemma && definitions[lemma]) {
    return { word, lemma, defs: definitions[lemma] };
  }
  return null;
}

export function isWord(w: string): boolean {
  if (!words) loadDictionary();
  return words!.has(w.toLowerCase());
}

/**
 * Enumerate all valid Boggle words on a board of the given edge length.
 * Uses the trie to prune branches whose prefix isn't in the dictionary.
 */
export function solveBoard(board: string[], size = 4): string[] {
  if (!trie) loadDictionary();
  const root = trie!;
  const faces = board.map((c) => c.toLowerCase());
  const n = faces.length;
  const cols = size;
  const rows = size;
  const found = new Set<string>();
  const visited = new Array<boolean>(n).fill(false);

  function neighborsOf(idx: number): number[] {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        out.push(nr * cols + nc);
      }
    }
    return out;
  }

  function walk(idx: number, node: TrieNode, chain: string) {
    const face = faces[idx];
    // face is one letter or "qu" — walk the trie one char at a time.
    let cur: TrieNode | undefined = node;
    let built = chain;
    for (const ch of face) {
      cur = cur.kids.get(ch);
      if (!cur) return;
      built += ch;
    }
    if (cur.end && built.length >= 3) found.add(built);
    for (const nb of neighborsOf(idx)) {
      if (visited[nb]) continue;
      visited[nb] = true;
      walk(nb, cur, built);
      visited[nb] = false;
    }
  }

  for (let i = 0; i < n; i++) {
    visited[i] = true;
    walk(i, root, "");
    visited[i] = false;
  }

  return [...found].sort((a, b) => a.length - b.length || a.localeCompare(b));
}
