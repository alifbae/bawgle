// Per-room identity handling.
//
// Tabs get their own identity (sessionStorage, per-tab) so two tabs on the
// same browser in the same room are distinct players. Closing a tab and
// coming back uses localStorage as a fallback so the slot is reclaimed.
//
// Flow on page load / first join:
//   1. If sessionStorage has a clientId, use it.
//   2. Otherwise, if localStorage has one, use it AND copy to sessionStorage.
//   3. Otherwise generate a fresh id and persist to both.
//
// If the server hands back a different clientId (we asked for X but another
// live tab is already using X, so it minted X:yyy), write the server value
// to both stores so this tab sticks with it on refresh.

const KEY_PREFIX = "bawgle.clientId.";

function generate(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(8);
  (crypto as Crypto).getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function keyFor(roomCode: string): string {
  return KEY_PREFIX + roomCode.toUpperCase();
}

export function getClientId(roomCode: string): string {
  const key = keyFor(roomCode);
  try {
    let id = sessionStorage.getItem(key);
    if (id) return id;

    // No per-tab id yet. If localStorage has one, inherit it so a reopened
    // tab can reclaim its slot.
    id = localStorage.getItem(key);
    if (!id) {
      id = generate();
      localStorage.setItem(key, id);
    }
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return generate();
  }
}

export function setClientId(roomCode: string, clientId: string): void {
  const key = keyFor(roomCode);
  try {
    sessionStorage.setItem(key, clientId);
    localStorage.setItem(key, clientId);
  } catch {
    // storage disabled — best-effort
  }
}
