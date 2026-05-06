import { flashFeedback } from "./ui/phase.ts";
import { getClientId } from "./util/client-id.ts";
import type { ClientMsg, ServerMsg } from "../shared/types.ts";

let ws: WebSocket | null = null;
let onMessage: ((msg: ServerMsg) => void) | null = null;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const basePath = location.pathname.replace(/\/[^/]*$/, "/");
  return `${proto}//${location.host}${basePath}ws`;
}

export function connectAndJoin(
  { code, name }: { code: string; name: string },
  handler: (msg: ServerMsg) => void
): void {
  onMessage = handler;
  ws = new WebSocket(wsUrl());
  ws.addEventListener("open", () =>
    send({ t: "join", code, name, clientId: getClientId(code) })
  );
  ws.addEventListener("message", (e) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    onMessage?.(msg);
  });
  ws.addEventListener("close", () => flashFeedback("Disconnected", "bad"));
}

export function isConnected(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function send(msg: ClientMsg): void {
  if (isConnected() && ws) ws.send(JSON.stringify(msg));
}

export function hasSocket(): boolean {
  return !!ws;
}
