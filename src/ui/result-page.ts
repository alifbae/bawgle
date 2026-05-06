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
  | { status: "ok"; round: StoredRound }
  | { status: "in_progress"; phase: string }
  | { status: "not_found" };

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
    renderRound(body.round);
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

function renderRound(round: StoredRound): void {
  // Build a RoomState stand-in so renderResults can render normally.
  // meId is null — no "(you)" marker, no host affordances.
  const state: RoomState = {
    code: round.roomCode,
    phase: "results",
    board: round.board,
    endsAt: null,
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

  const title = document.querySelector<HTMLElement>(".results-title");
  if (title) {
    const when = new Date(round.endedAt);
    title.textContent = `Round ${round.id} — ${round.roomCode} · ${when.toLocaleString()}`;
  }

  dom.playAgainBtn.hidden = true;
  const footer = dom.playAgainBtn.parentElement;
  if (footer && !footer.querySelector(".result-home-link")) {
    const home = document.createElement("a");
    home.className = "btn result-home-link";
    home.textContent = "start your own round";
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
