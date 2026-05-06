// Definition tooltip for result-screen word pills.
//
// Attaches one global tooltip element to the page and a delegated click +
// hover handler on the results body. Caches fetched definitions in memory
// so repeated taps on the same word don't re-fetch.

import { escape } from "../util/escape.ts";

interface DefinitionResponse {
  word: string;
  lemma?: string | null;
  defs: { pos: string; def: string }[];
}

const cache = new Map<string, DefinitionResponse>();
let tooltipEl: HTMLElement | null = null;
let activeChip: HTMLElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function ensureTooltip(): HTMLElement {
  if (tooltipEl) return tooltipEl;
  const el = document.createElement("div");
  el.className = "def-tooltip";
  el.setAttribute("role", "tooltip");
  el.hidden = true;
  document.body.appendChild(el);
  tooltipEl = el;
  return el;
}

function hide() {
  if (!tooltipEl) return;
  tooltipEl.hidden = true;
  tooltipEl.classList.remove("visible");
  activeChip = null;
}

function positionAbove(chip: HTMLElement) {
  const el = ensureTooltip();
  const r = chip.getBoundingClientRect();

  // Measure the tooltip at its natural width. We reset max-width before
  // each measurement so the previous position doesn't narrow the new one.
  el.hidden = false;
  el.style.maxWidth = "22rem";
  el.style.left = "0px";
  el.style.top = "0px";
  const tr = el.getBoundingClientRect();

  const margin = 8;
  const viewportW = window.innerWidth;
  const chipCenter = r.left + r.width / 2;

  // Decide anchor: if a tooltip centered on the pill would overflow the
  // right edge more than the left, anchor to the pill's right edge instead
  // so the tooltip grows to the left and can use the full available width
  // on that side.
  const wouldOverflowRight = chipCenter + tr.width / 2 > viewportW - margin;
  const roomLeft = r.right - margin;

  let left: number;
  if (wouldOverflowRight && roomLeft > 0) {
    // Anchor tooltip's right edge to the pill's right edge (within margin).
    left = r.right - tr.width;
    // If the tooltip is wider than the whole available area, cap its width
    // to that space so it doesn't go off-screen to the left either.
    if (left < margin) {
      el.style.maxWidth = `${r.right - margin}px`;
      const tr2 = el.getBoundingClientRect();
      left = r.right - tr2.width;
    }
  } else {
    // Normal case: center on the pill, clamped to viewport.
    left = Math.max(
      margin,
      Math.min(viewportW - tr.width - margin, chipCenter - tr.width / 2)
    );
  }

  // Re-measure after potential max-width change.
  const tr2 = el.getBoundingClientRect();
  const spaceAbove = r.top;
  const spaceBelow = window.innerHeight - r.bottom;
  const placeAbove = spaceAbove >= tr2.height + 12 || spaceAbove > spaceBelow;
  const top = placeAbove ? r.top - tr2.height - 10 : r.bottom + 10;

  el.style.left = `${left + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
  el.classList.toggle("above", placeAbove);
  el.classList.toggle("below", !placeAbove);
  el.classList.add("visible");
}

function render(res: DefinitionResponse): string {
  if (!res.defs.length) {
    return `
      <div class="def-word">${escape(res.word.toUpperCase())}</div>
      <div class="def-empty muted small">no definition available</div>
    `;
  }
  const lemmaNote = res.lemma
    ? `<span class="def-lemma muted small">(from ${escape(res.lemma)})</span>`
    : "";
  const senses = res.defs
    .slice(0, 2)
    .map(
      (d) => `
      <div class="def-sense">
        <span class="def-pos">${escape(d.pos)}</span>
        <span class="def-text">${escape(d.def)}</span>
      </div>`
    )
    .join("");
  return `
    <div class="def-word">${escape(res.word.toUpperCase())}${lemmaNote}</div>
    ${senses}
  `;
}

async function fetchDefinition(word: string): Promise<DefinitionResponse> {
  const cached = cache.get(word);
  if (cached) return cached;
  // Honor the proxy prefix when served at /bawgle/.
  const base = location.pathname.replace(/\/[^/]*$/, "/");
  const res = await fetch(`${base}api/define/${encodeURIComponent(word)}`);
  const data = (await res.json()) as DefinitionResponse;
  cache.set(word, data);
  return data;
}

async function showFor(chip: HTMLElement) {
  const word = chip.dataset.word;
  if (!word) return;
  if (activeChip === chip) return;
  activeChip = chip;
  const el = ensureTooltip();
  el.innerHTML =
    `<div class="def-word">${escape(word.toUpperCase())}</div>` +
    `<div class="def-loading muted small">…</div>`;
  positionAbove(chip);
  try {
    const res = await fetchDefinition(word);
    if (activeChip !== chip) return; // user moved on
    el.innerHTML = render(res);
    positionAbove(chip);
  } catch {
    if (activeChip !== chip) return;
    el.innerHTML = `<div class="def-empty muted small">lookup failed</div>`;
  }
}

function scheduleHoverOpen(chip: HTMLElement) {
  clearHoverTimer();
  hoverTimer = setTimeout(() => showFor(chip), 250);
}

function clearHoverTimer() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

/**
 * Install a delegated listener on the given root so every descendant
 * `.chip[data-word]` gets click + hover tooltip behavior. Call once when
 * the results screen is rendered; safe to call multiple times (handlers
 * are installed on the root, not on individual chips).
 */
export function attachDefinitionTooltip(root: HTMLElement) {
  // Click / tap: toggle
  root.addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".chip[data-word]"
    );
    if (!chip) return;
    e.stopPropagation();
    if (activeChip === chip) {
      hide();
    } else {
      showFor(chip);
    }
  });

  // Hover (desktop)
  root.addEventListener("mouseover", (e) => {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".chip[data-word]"
    );
    if (!chip) return;
    scheduleHoverOpen(chip);
  });
  root.addEventListener("mouseout", (e) => {
    const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".chip[data-word]"
    );
    if (!chip) return;
    clearHoverTimer();
    // Don't hide on mouseout if the user is reading a tapped tooltip;
    // let clicks/outside-tap do that.
    if (!activeChip) return;
    if (activeChip === chip) {
      // moving away from the hovered chip — hide soon after
      setTimeout(() => {
        if (activeChip === chip) hide();
      }, 120);
    }
  });

  // Outside click dismisses
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest(".chip[data-word]")) return;
    if (tooltipEl && tooltipEl.contains(t)) return;
    hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
}
