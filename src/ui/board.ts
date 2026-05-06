import { dom } from "../dom.ts";
import { neighbors, setBoardSize } from "../game/path.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Targets for rendering a board. Defaults to the live playing board
 * but accepts a distinct element pair so the results preview can show
 * its own copy without clobbering the primary board's DOM.
 */
export interface BoardTargets {
  board: HTMLElement;
  trail: SVGElement;
}

function defaultTargets(): BoardTargets {
  return { board: dom.board, trail: dom.boardTrail };
}

export function renderBoard(
  board: string[] | null | undefined,
  size = 4,
  targets: BoardTargets = defaultTargets(),
): void {
  setBoardSize(size);
  targets.board.style.setProperty("--board-size", String(size));

  // Keep the SVG trail element; remove only dice
  for (const el of [...targets.board.children]) {
    if (el !== targets.trail) el.remove();
  }
  const total = size * size;
  if (!board) {
    for (let i = 0; i < total; i++) {
      targets.board.appendChild(makeCap("·", i, true));
    }
    clearTrail(targets);
    return;
  }
  for (let i = 0; i < board.length; i++) {
    const face = board[i];
    const label = face === "Qu" ? "Qu" : face.toUpperCase();
    targets.board.appendChild(makeCap(label, i, false));
  }
}

function makeCap(
  label: string,
  index: number,
  placeholder: boolean
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "die" + (placeholder ? " placeholder" : "");
  btn.dataset.index = String(index);
  btn.setAttribute("aria-label", placeholder ? "empty tile" : `letter ${label}`);
  if (placeholder) btn.disabled = true;

  const base = document.createElement("span");
  base.className = "cap-base";

  const top = document.createElement("span");
  top.className = "cap-top";
  const lbl = document.createElement("span");
  lbl.className = "cap-label";
  lbl.textContent = label;
  top.appendChild(lbl);

  btn.appendChild(base);
  btn.appendChild(top);
  return btn;
}

export function applyPathUI(
  pathIndices: number[],
  targets: BoardTargets = defaultTargets(),
): void {
  const selSet = new Set(pathIndices);
  const last = pathIndices[pathIndices.length - 1];
  const adjSet =
    last !== undefined
      ? new Set(neighbors(last).filter((i) => !selSet.has(i)))
      : new Set<number>();

  for (const el of targets.board.querySelectorAll<HTMLElement>(".die")) {
    const i = Number(el.dataset.index);
    el.classList.toggle("selected", selSet.has(i));
    el.classList.toggle("last", i === last);
    el.classList.toggle("adjacent", adjSet.has(i));
  }
}

export function pulsePress(index: number): void {
  const el = dom.board.querySelector<HTMLElement>(`.die[data-index="${index}"]`);
  if (!el) return;
  el.classList.remove("pressed");
  // force reflow
  void el.offsetWidth;
  el.classList.add("pressed");
  setTimeout(() => el.classList.remove("pressed"), 130);
}

/* ---------- SVG trail ---------- */

function capCenter(
  index: number,
  targets: BoardTargets,
): { x: number; y: number } | null {
  const el = targets.board.querySelector<HTMLElement>(
    `.die[data-index="${index}"]`,
  );
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const boardRect = targets.board.getBoundingClientRect();
  return {
    x: rect.left - boardRect.left + rect.width / 2,
    y: rect.top - boardRect.top + rect.height / 2,
  };
}

export function clearTrail(targets: BoardTargets = defaultTargets()): void {
  targets.trail.innerHTML = "";
}

export function drawTrail(
  pathIndices: number[],
  targets: BoardTargets = defaultTargets(),
): void {
  clearTrail(targets);
  if (pathIndices.length < 2) return;

  const rect = targets.board.getBoundingClientRect();
  targets.trail.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  targets.trail.setAttribute("preserveAspectRatio", "none");

  const points = pathIndices
    .map((i) => capCenter(i, targets))
    .filter((p): p is { x: number; y: number } => p !== null);
  if (points.length < 2) return;

  const d = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", "trail-line");
  path.setAttribute("d", d);
  targets.trail.appendChild(path);
}

export function updateCurrentWord(text: string): void {
  if (text.length === 0) {
    dom.currentWord.innerHTML =
      '<span class="cw-placeholder">' +
      '<span class="cw-hint-desktop">tap, type, or slide</span>' +
      '<span class="cw-hint-touch">tap or slide</span>' +
      "</span>";
    dom.currentWord.classList.remove("invalid");
    dom.undoBtn.hidden = true;
    dom.submitBtn.hidden = true;
  } else {
    dom.currentWord.textContent = text.toUpperCase();
    dom.currentWord.classList.toggle("invalid", text.length < 3);
    dom.undoBtn.hidden = false;
    dom.submitBtn.hidden = false;
  }
}

export function findCapUnderPoint(clientX: number, clientY: number): number {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return -1;
  const die = el.closest<HTMLButtonElement>(".die");
  if (!die || !dom.board.contains(die) || die.disabled) return -1;
  return Number(die.dataset.index);
}

/**
 * Nearest-center lookup tuned for drag gestures.
 */
export function findCapNearPoint(
  clientX: number,
  clientY: number,
  tolerance = 0.55
): number {
  const dice = dom.board.querySelectorAll<HTMLButtonElement>(".die:not(:disabled)");
  let bestIdx = -1;
  let bestDistSq = Infinity;
  let tileSize = 0;

  for (const die of dice) {
    const rect = die.getBoundingClientRect();
    if (!tileSize) tileSize = Math.max(rect.width, rect.height);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = Number(die.dataset.index);
    }
  }

  if (bestIdx === -1) return -1;
  const maxDist = tileSize * tolerance;
  if (bestDistSq > maxDist * maxDist) return -1;
  return bestIdx;
}
