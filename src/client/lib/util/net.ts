// WebSocket client. Exponential-backoff reconnect. Routes incoming
// messages into the room + feedback stores and calls back to the
// caller for word-result audio/haptics.

import { getClientId, setClientId } from "./client-id.ts";
import { room } from "../stores/room.ts";
import { flashFeedback } from "../stores/feedback.ts";
import { submit as fbSubmit, reject as fbReject } from "./audio.ts";
import type { ClientMsg, RoomSettings, ServerMsg } from "../../../shared/types.ts";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

let ws: WebSocket | null = null;
let joinPayload: { code: string; name: string } | null = null;
// Settings the caller asked us to apply right after the first join
// (host-side only — "make this room private from the start" style
// knobs). We only ship these once on the first successful join; a
// subsequent reconnect uses whatever settings the room has accrued
// by then, so we don't clobber live state on a transient socket drop.
let initialSettings: Partial<RoomSettings> | null = null;
let initialSettingsSent = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let intentionalClose = false;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const basePath = location.pathname.replace(/\/[^/]*$/, "/");
  return `${proto}//${location.host}${basePath}ws`;
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (intentionalClose || !joinPayload) return;
  clearReconnect();
  const delay =
    RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(openSocket, delay);
}

function handleServerMessage(msg: ServerMsg): void {
  switch (msg.t) {
    case "joined":
      if (msg.state?.code) {
        setClientId(msg.state.code, msg.clientId);
      }
      room.apply({ meId: msg.you, state: msg.state });
      // First successful join for this session — ship any host-side
      // initial settings (e.g. "private") now that the server has a
      // room to attach them to. Subsequent reconnects skip this so
      // we don't overwrite anything that changed mid-session.
      if (initialSettings && !initialSettingsSent) {
        initialSettingsSent = true;
        send({ t: "settings", settings: initialSettings });
      }
      break;
    case "state":
      room.apply({ state: msg.state });
      break;
    case "word_result":
      if (msg.ok) {
        fbSubmit();
        flashFeedback(`+${msg.points ?? 0} ✓ ${msg.word.toUpperCase()}`, "ok");
      } else {
        fbReject();
        flashFeedback(`✗ ${msg.reason ?? "rejected"}`, "bad");
      }
      break;
    case "error":
      flashFeedback(msg.message, "bad");
      break;
  }
}

function openSocket(): void {
  if (!joinPayload) return;
  const { code, name } = joinPayload;

  ws = new WebSocket(wsUrl());

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    send({ t: "join", code, name, clientId: getClientId(code) });
  });

  ws.addEventListener("message", (e) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(typeof e.data === "string" ? e.data : "");
    } catch {
      return;
    }
    handleServerMessage(msg);
  });

  ws.addEventListener("close", () => {
    ws = null;
    if (intentionalClose) {
      intentionalClose = false;
      return;
    }
    if (reconnectAttempt === 0) {
      flashFeedback("Connection lost — reconnecting", "bad");
    }
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    /* error always precedes close; close handles UX */
  });
}

export function connectAndJoin(
  { code, name }: { code: string; name: string },
  opts: { initialSettings?: Partial<RoomSettings> } = {},
): void {
  joinPayload = { code, name };
  initialSettings = opts.initialSettings ?? null;
  initialSettingsSent = false;
  intentionalClose = false;
  reconnectAttempt = 0;
  clearReconnect();
  openSocket();
}

export function isConnected(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function hasSocket(): boolean {
  return !!ws || !!joinPayload;
}

export function send(msg: ClientMsg): void {
  if (!isConnected() || !ws) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* half-open socket; close handler will reconnect */
  }
}

export function disconnect(): void {
  intentionalClose = true;
  joinPayload = null;
  initialSettings = null;
  initialSettingsSent = false;
  clearReconnect();
  reconnectAttempt = 0;
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
}
