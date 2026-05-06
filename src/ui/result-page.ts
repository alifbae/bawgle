// Shareable, read-only results page.
//
// Mounted when the SPA is loaded at `/result?round=N` or
// `/result?room=XYZ`. Fetches the round snapshot from the server and
// renders it via the same `renderResults` the live results screen uses,
// so pills, scores, and missed-word lists look identical.
//
// URL params, in precedence order:
//   ?round=N   preferred; explicit round id; stable even after
//              "play again" starts a new round in the same room
//   ?room=XYZ  fallback; resolves to the most recent round for the
//              given room code. Breaks once a newer round exists.
//
// Edge cases handled:
//   - round id that doesn't exist / room that never played → friendly
//     "not found" message
//   - room exists but never finished a round → "in progress" state
//   - server errors → show the message and a back-link to /

import { renderResults } from "./words.ts";
import { setPhase } from "./phase.ts";
import { dom } from "../dom.ts";
import { installResultsPreview } from "./results-preview.ts";
import type { RoomState } from "../../shared/types.ts";

interface StoredRound {
  id: number;
  roomCode: string;
  startedAt: number;
  endedAt: number;
  board: string[];
  settings: RoomState["settings"];
  hostId: string | null;
  players: Array<{ id: string; name: string; score: number; words: string[] }>;
  possibleWords: string[];
}

type ApiResponse =
  | { status: "ok"; round: StoredRound; roomStatus: RoomStatus }
  | { status: "in_progress"; phase: string }
  | { status: "not_found" };

type RoomStatus = "active" | "inactive" | "closed";

export async function initResultPage(): Promise<void> {
  // Strip the normal SPA chrome we don't need on this page.
  document.body.classList.add("is-result-page");
  dom.lobby.classList.add("hidden");
  dom.room.classList.add("hidden");

  setPhase("results");

  const params = new URLSearchParams(location.search);
  const roundIdRaw = params.get("round");
  const roundId = roundIdRaw ? Number(roundIdRaw) : NaN;
  const rawCode = (params.get("room") || "").toUpperCase();
  const code = rawCode.replace(/[^A-Z0-9]/g, "").slice(0, 4);

  let endpoint: string | null = null;
  if (Number.isFinite(roundId) && roundId > 0) {
    endpoint = `./api/round/${roundId}`;
  } else if (code) {
    endpoint = `./api/room/${encodeURIComponent(code)}/round`;
  }

  if (!endpoint) {
    renderError(
      "No round specified in the URL. Share a link like /result?round=42 or /result?room=ABC1.",
    );
    return;
  }

  try {
    const res = await fetch(endpoint);
    if (res.status === 404) {
      renderError(
        roundIdRaw
          ? `Round ${roundIdRaw} isn't recognized. The link may have been mistyped, or the round has aged out of history.`
          : `Room ${code} isn't recognized or has no completed rounds. Rounds are retained for 30 days.`,
      );
      return;
    }
    const body = (await res.json()) as ApiResponse;
    if (body.status === "in_progress") {
      renderError(
        `Room ${code} hasn't finished a round yet. Check back once the players wrap up.`,
      );
      return;
    }
    if (body.status !== "ok") {
      renderError(`Couldn't load results.`);
      return;
    }
    renderRound(body.round, body.roomStatus);
  } catch (err) {
    renderError(
      `Couldn't load results: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function renderError(msg: string): void {
  const title = document.querySelector<HTMLElement>(".results-title");
  if (title) title.textContent = "Results";
  dom.resultsBody.innerHTML = `
    <div class="result-empty">
      <p>${escapeHtml(msg)}</p>
      <a class="btn" href="./">back to bawgle</a>
    </div>
  `;
  dom.playAgainBtn.hidden = true;
}

function renderRound(round: StoredRound, roomStatus: RoomStatus): void {
  // Build a RoomState stand-in so renderResults can render normally.
  // meId is null — no "(you)" marker, no host affordances.
  const state: RoomState = {
    code: round.roomCode,
    phase: "results",
    board: round.board,
    endsAt: null,
    startsAt: null,
    players: round.players.map((p) => ({
      id: p.id,
      clientId: `shared-${p.id}`,
      name: p.name,
      connected: false,
      ready: false,
      score: p.score,
      words: p.words,
    })),
    hostId: round.hostId,
    settings: round.settings,
    possibleCount: round.possibleWords.length,
    possibleWords: round.possibleWords,
    lastRoundId: round.id,
  };

  renderResults(state, null);

  // Same board preview as the live results screen. Requires a board
  // with actual faces; shared snapshots always carry one.
  if (round.board && round.board.length > 0) {
    const size = Math.sqrt(round.board.length);
    if (size === 4 || size === 5 || size === 6) {
      installResultsPreview(round.board, size);
    }
  }

  // Replace the generic "round over" title with a structured meta
  // block: Room / Round / Date on aligned rows.
  const title = document.querySelector<HTMLElement>(".results-title");
  if (title) {
    const when = new Date(round.endedAt);
    const day = when.toLocaleDateString(undefined, { weekday: "short" });
    const date = when.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
    const time = when.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    title.classList.add("results-meta");
    const statusLabel: Record<RoomStatus, string> = {
      active: "active",
      inactive: "inactive",
      closed: "closed",
    };

    // Build the Room row's value. If the room is still reachable
    // (active or inactive — not closed), wrap the code + pill in a
    // link back to the main app with the room code pre-filled. Closed
    // rooms render as plain text so recipients don't hit a dead link.
    const roomLink = `./?room=${encodeURIComponent(round.roomCode)}`;
    const isReachable = roomStatus !== "closed";
    const roomValue = isReachable
      ? `<a class="room-link" href="${roomLink}">
           <code>${escapeHtml(round.roomCode)}</code>
           <span class="room-status room-status-${roomStatus}">${statusLabel[roomStatus]}</span>
         </a>`
      : `<code>${escapeHtml(round.roomCode)}</code>
         <span class="room-status room-status-${roomStatus}">${statusLabel[roomStatus]}</span>`;

    title.innerHTML = `
      <dl class="meta-list">
        <div class="meta-main">
          <div class="meta-row">
            <dt>Room</dt>
            <dd>${roomValue}</dd>
          </div>
          <div class="meta-row">
            <dt>Round</dt>
            <dd>#${round.id}</dd>
          </div>
        </div>
        <div class="meta-row meta-date">
          <dt>Date</dt>
          <dd>${escapeHtml(day)}, ${escapeHtml(date)} · ${escapeHtml(time)}</dd>
        </div>
      </dl>
    `;
  }

  dom.playAgainBtn.hidden = true;
  const footer = dom.playAgainBtn.parentElement;
  if (footer && !footer.querySelector(".result-home-link")) {
    const home = document.createElement("a");
    home.className = "btn primary result-home-link";
    home.textContent = "start a new game";
    home.href = "./";
    footer.appendChild(home);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[ch] ?? ch;
  });
}
