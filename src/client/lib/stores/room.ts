// Room state store — wraps the WebSocket `joined`/`state` messages into a
// Svelte `writable` so every component can subscribe with the `$store`
// syntax. The server is the source of truth; we only mutate locally when
// a server message lands.
//
// Mirrors the old createRoomStore shape but uses Svelte's writable so
// templates can read `$room.state.phase` directly.

import { derived, writable } from "svelte/store";
import type { RoomState } from "../../../shared/types.ts";

export interface RoomSnapshot {
  state: RoomState | null;
  meId: string | null;
  /** Phase from the previous snapshot, or null on first paint. Useful
   *  for transition-sensitive UI (armed play-again, uninstall preview). */
  prevPhase: RoomState["phase"] | null;
}

function emptySnap(): RoomSnapshot {
  return { state: null, meId: null, prevPhase: null };
}

function createRoom() {
  const store = writable<RoomSnapshot>(emptySnap());

  function apply(patch: Partial<Omit<RoomSnapshot, "prevPhase">>): void {
    store.update((snap) => {
      let prevPhase = snap.prevPhase;
      let changed = false;
      if ("state" in patch && patch.state !== snap.state) {
        prevPhase = snap.state?.phase ?? null;
        changed = true;
      }
      if ("meId" in patch && patch.meId !== snap.meId) {
        changed = true;
      }
      if (!changed) return snap;
      return {
        state: "state" in patch ? (patch.state ?? null) : snap.state,
        meId: "meId" in patch ? (patch.meId ?? null) : snap.meId,
        prevPhase,
      };
    });
  }

  return {
    subscribe: store.subscribe,
    apply,
    reset() {
      store.set(emptySnap());
    },
  };
}

export const room = createRoom();

/** Convenience: the current phase (or null before a `joined` lands). */
export const phase = derived(room, ($r) => $r.state?.phase ?? null);

/** Convenience: "am I the host?" — used by components that toggle
 *  host-only controls. */
export const isHost = derived(room, ($r) => {
  const s = $r.state;
  return !!s && !!s.hostId && !!$r.meId && s.hostId === $r.meId;
});
