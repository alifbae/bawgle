import { flashFeedback } from "./ui/phase.ts";
import { getClientId } from "./util/client-id.ts";
import type { ClientMsg, ServerMsg } from "../shared/types.ts";

// Reconnect tuning: exponential backoff so a flaky connection doesn't
// hammer the server, but fast enough that a transient drop (tab sleep,
// nat rebind) recovers without the player noticing. Resets to 0 on a
// successful open.
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

let ws: WebSocket | null = null;
let onMessage: ((msg: ServerMsg) => void) | null = null;
let joinPayload: { code: string; name: string } | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
// Distinguishes "user left on purpose" (don't reconnect) from "socket
// dropped" (reconnect).
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
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(openSocket, delay);
}

function openSocket(): void {
  if (!joinPayload || !onMessage) return;
  const { code, name } = joinPayload;

  ws = new WebSocket(wsUrl());

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    if (reconnectTimer === null) {
      // Only show a reconnected toast on follow-up connects, not the
      // initial join — otherwise every page load flashes "reconnected".
    }
    send({ t: "join", code, name, clientId: getClientId(code) });
  });

  ws.addEventListener("message", (e) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(typeof e.data === "string" ? e.data : "");
    } catch {
      return;
    }
    onMessage?.(msg);
  });

  ws.addEventListener("close", () => {
    ws = null;
    if (intentionalClose) {
      intentionalClose = false;
      return;
    }
    if (reconnectAttempt === 0) {
      // First drop after a live connection. Tell the user we're trying.
      flashFeedback("Connection lost — reconnecting", "bad");
    }
    scheduleReconnect();
  });

  // Error events always precede close; reporting both floods the
  // feedback line, so we ignore error and let close handle the UI.
  ws.addEventListener("error", () => {
    /* swallow; close handler takes over */
  });
}

export function connectAndJoin(
  { code, name }: { code: string; name: string },
  handler: (msg: ServerMsg) => void,
): void {
  // Calling this while a live socket exists is a no-op; the caller
  // flow ensures `hasSocket()` is checked first. Reset reconnect
  // state for a fresh join.
  onMessage = handler;
  joinPayload = { code, name };
  intentionalClose = false;
  reconnectAttempt = 0;
  clearReconnect();
  openSocket();
}

export function isConnected(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function send(msg: ClientMsg): void {
  if (!isConnected() || !ws) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Half-open socket. Close handler will reconnect.
  }
}

export function hasSocket(): boolean {
  return !!ws || !!joinPayload;
}

/**
 * Cleanly shut down the connection and prevent auto-reconnect. Call
 * this when the user explicitly leaves the room.
 */
export function disconnect(): void {
  intentionalClose = true;
  joinPayload = null;
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
