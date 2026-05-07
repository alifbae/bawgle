// Share-text formatter for WhatsApp / Messages / native share sheets.
//
// Single-line, compact: room code brand + crowned winner + the URL.
// WhatsApp prepends the `title` from navigator.share onto the body, so
// we keep all the content in the `text` field and pass no title at the
// call site.
//
//   bawgle - 👑 ALFA (30), BETA (22), GAMA (10) https://.../result?round=42

import type { RoomState } from "../../../shared/types.ts";

/**
 * Build a WhatsApp-friendly share message. Falls back to just the URL
 * if the state has no players to summarize.
 */
export function buildShareText(state: RoomState | null, url: string): string {
  if (!state || state.players.length === 0) return url;

  const ranked = [...state.players].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
  const top = ranked[0]!.score;
  const crown = "👑";

  const parts = ranked.map((p, i) => {
    const isWinner = top > 0 && p.score === top;
    const prefix = isWinner && i === 0 ? `${crown} ` : "";
    return `${prefix}${p.name} (${p.score})`;
  });

  return `bawgle - ${parts.join(", ")} ${url}`;
}

