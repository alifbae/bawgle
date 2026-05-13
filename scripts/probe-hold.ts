// Hold the WS open so we can inspect mid-session DB state.
//
//   tsx scripts/probe-hold.ts

import WebSocket from "ws";

interface JoinedMsg {
  t: "joined";
  you: string;
}

interface StateMsg {
  t: "state";
  state: {
    hostId: string;
    players: unknown[];
  };
}

type ProbeMsg = JoinedMsg | StateMsg | { t: string; [k: string]: unknown };

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

ws.on("message", (data: WebSocket.RawData) => {
  const msg = JSON.parse(data.toString()) as ProbeMsg;
  if (msg.t === "joined") {
    console.log(`joined as ${(msg as JoinedMsg).you}`);
  }
  if (msg.t === "state") {
    const { hostId, players } = (msg as StateMsg).state;
    console.log(`state: host=${hostId} players=${players.length}`);
  }
});

// Keep alive until SIGTERM
process.on("SIGTERM", () => ws.close());
process.on("SIGINT", () => ws.close());
