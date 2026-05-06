import { dom } from "../dom.ts";
import { escape } from "../util/escape.ts";
import type { RoomState } from "../../shared/types.ts";

export function renderPlayers(state: RoomState, meId: string | null): void {
  dom.players.innerHTML = "";
  const inLobby = state.phase === "lobby";
  const sorted = [...state.players].sort((a, b) => b.score - a.score);

  for (const p of sorted) {
    // Host is implicit-ready in the lobby; scores are only meaningful once
    // a round has run.
    const effectiveReady = inLobby && (p.ready || p.id === state.hostId);

    const el = document.createElement("div");
    el.className = "player";
    if (p.id === meId) el.classList.add("me");
    if (!p.connected) el.classList.add("offline");
    if (p.id === state.hostId) el.classList.add("host");
    if (effectiveReady) el.classList.add("ready");

    const hostMark =
      p.id === state.hostId ? '<span class="host-mark" title="host">H</span>' : "";
    const meMark = p.id === meId ? '<span class="me-mark">(you)</span>' : "";
    const readyMark = effectiveReady
      ? '<span class="ready-mark" title="ready">✓</span>'
      : "";
    const score = inLobby ? "" : `<span class="pscore">${p.score}</span>`;

    el.innerHTML = `<span class="pname">${hostMark}${escape(p.name)}${meMark}${readyMark}</span>${score}`;
    dom.players.appendChild(el);
  }
}
