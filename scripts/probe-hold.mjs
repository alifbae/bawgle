// Hold the WS open so we can inspect mid-session DB state.
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3001/ws");
const clientId = `probe-hold-${Math.random().toString(36).slice(2, 8)}`;

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      t: "join",
      code: "ALIVE",
      name: "held",
      clientId,
    })
  );
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.t === "joined") console.log(`joined as ${msg.you}`);
  if (msg.t === "state")
    console.log(`state: host=${msg.state.hostId} players=${msg.state.players.length}`);
});

// Keep alive until SIGTERM
process.on("SIGTERM", () => ws.close());
process.on("SIGINT", () => ws.close());
