// Quick smoke test: open a WS, join a room, wait for state, then close.
// Verifies the server persists rooms on join.
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3001/ws");
const clientId = `probe-${Math.random().toString(36).slice(2, 8)}`;

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      t: "join",
      code: "PERSIST-TEST",
      name: "probe",
      clientId,
    })
  );
});

let received = 0;
ws.on("message", (data) => {
  received++;
  const msg = JSON.parse(data.toString());
  console.log(
    "recv:",
    msg.t,
    msg.state ? `phase=${msg.state.phase} players=${msg.state.players.length}` : ""
  );
  if (received >= 2) {
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});

ws.on("error", (e) => {
  console.error("ws error", e.message);
  process.exit(1);
});
