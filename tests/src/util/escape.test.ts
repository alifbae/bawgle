import { describe, expect, it } from "vitest";
import { escape } from "../../../src/client/lib/util/escape.ts";

describe("escape", () => {
  it("escapes the five standard HTML entities", () => {
    expect(escape("<a>&'\"</a>")).toBe("&lt;a&gt;&amp;&#39;&quot;&lt;/a&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(escape("hello world 123")).toBe("hello world 123");
  });

  it("coerces non-strings", () => {
    expect(escape(42)).toBe("42");
    expect(escape(null)).toBe("null");
    expect(escape(undefined)).toBe("undefined");
  });
});
