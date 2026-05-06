// HTTP Basic auth + per-IP throttle for the admin surface.
//
// The throttle matters because the dashboard polls 3× per 3s, so if we
// counted no-credential requests toward the limit a single stale
// browser tab could lock the real user out in seconds. Coverage here:
//
//   - wrong creds with an Authorization header advance the counter
//   - no Authorization header doesn't count (it's a probe, not a guess)
//   - the IP gets 429'd after MAX_FAILS failures
//   - a successful auth clears the counter

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface HeaderBag {
  [k: string]: string | undefined;
}

function buildContext(headers: HeaderBag) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
  } as unknown as import("hono").Context;
}

function basicHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

// Reset the module graph per test so throttle state and env vars
// don't bleed between cases.
async function loadAuth(env: HeaderBag = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("../../server/admin/auth.ts");
}

describe("admin auth", () => {
  const originalEnv: HeaderBag = {
    BAWGLE_ADMIN_USER: process.env.BAWGLE_ADMIN_USER,
    BAWGLE_ADMIN_PASS: process.env.BAWGLE_ADMIN_PASS,
  };

  beforeEach(() => {
    // Ensure a clean baseline — admin enabled with a known password.
    process.env.BAWGLE_ADMIN_USER = "admin";
    process.env.BAWGLE_ADMIN_PASS = "correct-horse-battery";
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns 401 when no Authorization header is sent", async () => {
    const { requireAdmin } = await loadAuth();
    const res = requireAdmin(buildContext({}));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect(res!.headers.get("www-authenticate")).toMatch(/basic/i);
  });

  it("returns null (passes through) when credentials match", async () => {
    const { requireAdmin } = await loadAuth();
    const res = requireAdmin(
      buildContext({
        authorization: basicHeader("admin", "correct-horse-battery"),
      }),
    );
    expect(res).toBeNull();
  });

  it("is disabled entirely when BAWGLE_ADMIN_PASS is empty", async () => {
    const { requireAdmin, adminEnabled } = await loadAuth({
      BAWGLE_ADMIN_PASS: "",
    });
    expect(adminEnabled).toBe(false);
    const res = requireAdmin(
      buildContext({
        authorization: basicHeader("admin", "anything"),
      }),
    );
    // Anything without valid creds is 401, and no creds can be valid
    // against an empty password (constant-time check fails length).
    expect(res!.status).toBe(401);
  });

  it("locks out after repeated bad credential attempts from the same IP", async () => {
    const { requireAdmin, __resetAdminThrottleForTests } = await loadAuth();
    __resetAdminThrottleForTests();

    const badAuth = buildContext({
      authorization: basicHeader("admin", "nope"),
      "x-forwarded-for": "1.2.3.4",
    });

    // MAX_FAILS is 10 per auth.ts; first N-1 should be 401.
    for (let i = 0; i < 10; i++) {
      const r = requireAdmin(badAuth)!;
      expect(r.status).toBe(401);
    }

    // 11th attempt from the same IP hits the lockout — 429.
    const locked = requireAdmin(badAuth)!;
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("doesn't count requests without an Authorization header toward the lockout", async () => {
    const { requireAdmin, __resetAdminThrottleForTests } = await loadAuth();
    __resetAdminThrottleForTests();

    const noAuth = buildContext({ "x-forwarded-for": "5.6.7.8" });

    // Simulate the dashboard polling 20 times with no Authorization
    // header. Each 401s but shouldn't advance the throttle.
    for (let i = 0; i < 20; i++) {
      const r = requireAdmin(noAuth)!;
      expect(r.status).toBe(401);
    }

    // A fresh bad-creds attempt from the same IP should still be the
    // first counted failure, not the 21st.
    for (let i = 0; i < 10; i++) {
      const r = requireAdmin(
        buildContext({
          authorization: basicHeader("admin", "wrong"),
          "x-forwarded-for": "5.6.7.8",
        }),
      )!;
      expect(r.status).toBe(401);
    }
  });

  it("clears the throttle counter after a successful auth", async () => {
    const { requireAdmin, __resetAdminThrottleForTests } = await loadAuth();
    __resetAdminThrottleForTests();

    const badAuth = buildContext({
      authorization: basicHeader("admin", "nope"),
      "x-forwarded-for": "9.9.9.9",
    });
    const goodAuth = buildContext({
      authorization: basicHeader("admin", "correct-horse-battery"),
      "x-forwarded-for": "9.9.9.9",
    });

    for (let i = 0; i < 9; i++) requireAdmin(badAuth);

    // One success resets the counter.
    expect(requireAdmin(goodAuth)).toBeNull();

    // 10 more bad attempts should still fit without tripping 429.
    for (let i = 0; i < 10; i++) {
      expect(requireAdmin(badAuth)!.status).toBe(401);
    }
    // The 11th trips it.
    expect(requireAdmin(badAuth)!.status).toBe(429);
  });

  it("tracks throttle state per-IP — one bad actor doesn't lock the other", async () => {
    const { requireAdmin, __resetAdminThrottleForTests } = await loadAuth();
    __resetAdminThrottleForTests();

    const badFromA = buildContext({
      authorization: basicHeader("admin", "nope"),
      "x-forwarded-for": "1.1.1.1",
    });
    const goodFromB = buildContext({
      authorization: basicHeader("admin", "correct-horse-battery"),
      "x-forwarded-for": "2.2.2.2",
    });

    // Lock out A.
    for (let i = 0; i < 10; i++) requireAdmin(badFromA);
    expect(requireAdmin(badFromA)!.status).toBe(429);

    // B is untouched.
    expect(requireAdmin(goodFromB)).toBeNull();
  });
});
