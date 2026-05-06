// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { getClientId, setClientId } from "../../../src/util/client-id.ts";

describe("client-id", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("generates and persists a fresh id the first time", () => {
    const id = getClientId("ROOM");
    expect(id).toMatch(/.+/);
    expect(sessionStorage.getItem("bawgle.clientId.ROOM")).toBe(id);
    expect(localStorage.getItem("bawgle.clientId.ROOM")).toBe(id);
  });

  it("reuses the per-tab session id on subsequent calls", () => {
    const a = getClientId("ROOM");
    const b = getClientId("ROOM");
    expect(a).toBe(b);
  });

  it("inherits a localStorage id when sessionStorage is empty (reopened tab)", () => {
    localStorage.setItem("bawgle.clientId.ROOM", "persisted-id");
    const id = getClientId("ROOM");
    expect(id).toBe("persisted-id");
    // And populates sessionStorage so the tab sticks with it.
    expect(sessionStorage.getItem("bawgle.clientId.ROOM")).toBe("persisted-id");
  });

  it("namespaces ids per room code, case-insensitive", () => {
    const a = getClientId("ROOM");
    const b = getClientId("room");
    expect(a).toBe(b);

    const other = getClientId("DIFF");
    expect(other).not.toBe(a);
  });

  it("setClientId overwrites both stores", () => {
    getClientId("ROOM"); // seed
    setClientId("ROOM", "server-minted-id");
    expect(sessionStorage.getItem("bawgle.clientId.ROOM")).toBe("server-minted-id");
    expect(localStorage.getItem("bawgle.clientId.ROOM")).toBe("server-minted-id");
  });
});
