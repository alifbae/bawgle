// @vitest-environment jsdom
//
// Exhaustive coverage for attachInput() — the pointer + keyboard
// surface that drives word-path manipulation during play. Both of
// the known bugs (submit/undo box disappearing, tap-to-drag flaking)
// point at state-reset issues in this file, so the emphasis is on:
//
//   1. Every state flag (pointerActive, pointerMoved, pointerLastIdx,
//      tappedOnEnd, typed) resets correctly after every terminating
//      event (pointerup, pointercancel, Escape, phase change).
//   2. A *second* gesture after a completed one behaves like the
//      first. Many drag bugs only show up on the 2nd+ attempt.
//   3. Keyboard and pointer don't interfere with each other.
//
// findCapUnderPoint / findCapNearPoint are injected callbacks — we
// stub them per-test so the tests don't care about real DOM geometry.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachInput } from "../../../src/client/lib/util/input.ts";
import { createPathStore } from "../../../src/client/lib/stores/path.ts";
import { setBoardSize } from "../../../src/client/lib/stores/adjacency.ts";

// 4x4 board: C A T S / H E R U / P O L I / D N E G
const BOARD = [
  "C", "A", "T", "S",
  "H", "E", "R", "U",
  "P", "O", "L", "I",
  "D", "N", "E", "G",
];

// Construct a pointer-ish event. jsdom 25 has PointerEvent; fall back
// to MouseEvent with extra props if it ever regresses.
function pointerEvent(
  type: string,
  props: { clientX?: number; clientY?: number; pointerId?: number } = {},
): Event {
  const { clientX = 0, clientY = 0, pointerId = 1 } = props;
  try {
    return new PointerEvent(type, {
      clientX,
      clientY,
      pointerId,
      bubbles: true,
      cancelable: true,
    });
  } catch {
    const e = new MouseEvent(type, {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(e, "pointerId", { value: pointerId });
    return e;
  }
}

function keyEvent(type: string, init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
}

interface Harness {
  path: ReturnType<typeof createPathStore>;
  boardEl: HTMLElement;
  wordBarEl: HTMLElement;
  detach: () => void;
  onSubmit: ReturnType<typeof vi.fn>;
  onPress: ReturnType<typeof vi.fn>;
  capUnderPoint: ReturnType<typeof vi.fn>;
  capNearPoint: ReturnType<typeof vi.fn>;
  getPhase: ReturnType<typeof vi.fn>;
  getBoard: ReturnType<typeof vi.fn>;
}

/**
 * Build an attachInput harness. Default phase is "playing" and the
 * board returns BOARD; individual tests override via the setter.
 */
function mount(
  opts: {
    phase?: string;
    board?: string[] | null | undefined;
    capUnder?: (x: number, y: number) => number;
    capNear?: (x: number, y: number, t?: number) => number;
  } = {},
): Harness {
  const path = createPathStore();
  const boardEl = document.createElement("div");
  const wordBarEl = document.createElement("div");
  document.body.append(boardEl, wordBarEl);

  const onSubmit = vi.fn();
  const onPress = vi.fn();
  const capUnderPoint = vi.fn(opts.capUnder ?? (() => -1));
  const capNearPoint = vi.fn(opts.capNear ?? (() => -1));
  const getPhase = vi.fn(() => opts.phase ?? "playing");
  const getBoard = vi.fn(() => (opts.board === undefined ? BOARD : opts.board));

  const detach = attachInput({
    boardEl,
    wordBarEl,
    path,
    onSubmit,
    getBoard,
    getPhase,
    onPress,
    findCapUnderPoint: capUnderPoint,
    findCapNearPoint: capNearPoint,
  });

  return {
    path,
    boardEl,
    wordBarEl,
    detach,
    onSubmit,
    onPress,
    capUnderPoint,
    capNearPoint,
    getPhase,
    getBoard,
  };
}

beforeEach(() => {
  setBoardSize(4);
  document.body.innerHTML = "";
  // Clear any leftover focus so the keyboard "typing into an input"
  // guard doesn't leak across tests.
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe("attachInput — pointer: initial tap", () => {
  it("starts a path when tapping an empty board", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown", { clientX: 1, clientY: 1 }));
    expect(h.path.get()).toEqual([0]);
    expect(h.onPress).toHaveBeenCalledWith(0);
    h.detach();
  });

  it("ignores pointerdown when phase is not playing", () => {
    const h = mount({ phase: "lobby", capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([]);
    expect(h.onPress).not.toHaveBeenCalled();
    h.detach();
  });

  it("ignores pointerdown when the tile hit-test misses", () => {
    const h = mount({ capUnder: () => -1 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([]);
    expect(h.onPress).not.toHaveBeenCalled();
    h.detach();
  });

  it("extends the path when tapping an adjacent unvisited tile", () => {
    const h = mount();
    h.path.push(0);
    h.capUnderPoint.mockReturnValue(1);
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([0, 1]);
    expect(h.onPress).toHaveBeenLastCalledWith(1);
    h.detach();
  });

  it("resets the path when tapping a non-adjacent unvisited tile", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);
    // 3 is two columns away from 1 — not adjacent.
    h.capUnderPoint.mockReturnValue(3);
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([3]);
    h.detach();
  });

  it("trims the path when tapping a previously-selected non-last tile", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);
    h.path.push(2);
    h.capUnderPoint.mockReturnValue(1);
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([0, 1]);
    h.detach();
  });

  it("tapping the last tile is deferred; pointerup pops it", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);
    h.capUnderPoint.mockReturnValue(1);

    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    // Path unchanged on down (tile is the current last).
    expect(h.path.get()).toEqual([0, 1]);

    h.boardEl.dispatchEvent(pointerEvent("pointerup"));
    // pointerup with no movement + tappedOnEnd pops the tail.
    expect(h.path.get()).toEqual([0]);
    expect(h.onSubmit).not.toHaveBeenCalled();
    h.detach();
  });
});

describe("attachInput — pointer: drag", () => {
  it("slides along adjacent tiles as the pointer moves", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([0]);

    h.capNearPoint.mockReturnValueOnce(1).mockReturnValueOnce(5);
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 2 }));
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 3 }));
    expect(h.path.get()).toEqual([0, 1, 5]);
    h.detach();
  });

  it("trims when the drag revisits an earlier tile", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));

    h.capNearPoint.mockReturnValueOnce(1).mockReturnValueOnce(5).mockReturnValueOnce(1);
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 2 }));
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 3 }));
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 4 }));
    expect(h.path.get()).toEqual([0, 1]);
    h.detach();
  });

  it("ignores pointermove hits on non-adjacent tiles (does not reset)", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));

    // 10 is not adjacent to 0.
    h.capNearPoint.mockReturnValue(10);
    h.boardEl.dispatchEvent(pointerEvent("pointermove"));
    // Still just [0] — unlike pointerdown, move doesn't reset.
    expect(h.path.get()).toEqual([0]);
    h.detach();
  });

  it("ignores pointermove when not actively pressed", () => {
    const h = mount({ capNear: () => 1 });
    h.path.push(0);
    h.boardEl.dispatchEvent(pointerEvent("pointermove"));
    expect(h.path.get()).toEqual([0]);
    h.detach();
  });

  it("debounces move hits that land on the same tile twice", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));

    h.capNearPoint.mockReturnValue(1);
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 2 }));
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 3 }));
    // Second move targets the same last-index; onPress should fire
    // only once for tile 1.
    const pressCalls = h.onPress.mock.calls.filter((c) => c[0] === 1);
    expect(pressCalls).toHaveLength(1);
    h.detach();
  });
});

describe("attachInput — pointer: termination", () => {
  it("pointerup after a drag calls onSubmit", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));

    h.capNearPoint.mockReturnValue(1);
    h.boardEl.dispatchEvent(pointerEvent("pointermove"));

    h.boardEl.dispatchEvent(pointerEvent("pointerup"));
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    h.detach();
  });

  it("pointerup after a pure tap does not call onSubmit", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    h.boardEl.dispatchEvent(pointerEvent("pointerup"));
    expect(h.onSubmit).not.toHaveBeenCalled();
    h.detach();
  });

  it("pointerup without an active pointer is a no-op", () => {
    const h = mount();
    h.boardEl.dispatchEvent(pointerEvent("pointerup"));
    expect(h.onSubmit).not.toHaveBeenCalled();
    h.detach();
  });

  it("pointercancel clears active state so the next drag starts fresh", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));

    h.capNearPoint.mockReturnValue(1);
    h.boardEl.dispatchEvent(pointerEvent("pointermove"));

    h.boardEl.dispatchEvent(pointerEvent("pointercancel"));
    // cancel must NOT submit the half-dragged word.
    expect(h.onSubmit).not.toHaveBeenCalled();

    // New gesture: a second drag should now work from scratch.
    h.path.clear();
    h.capUnderPoint.mockReturnValue(2);
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([2]);
    h.detach();
  });

  it("a second drag after a completed drag behaves identically (regression: tap-to-drag wedging)", () => {
    // This is the core anti-regression test for the reported bug.
    const h = mount({ capUnder: () => 0 });

    // First drag: 0 → 1 → 5, submit.
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    h.capNearPoint.mockReturnValueOnce(1).mockReturnValueOnce(5);
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 2 }));
    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 3 }));
    h.boardEl.dispatchEvent(pointerEvent("pointerup"));
    expect(h.onSubmit).toHaveBeenCalledTimes(1);

    // Caller clears the path on submit; simulate that.
    h.path.clear();

    // Second drag: should behave exactly like the first.
    h.capUnderPoint.mockReturnValue(10);
    h.capNearPoint.mockReset();
    h.capNearPoint.mockReturnValueOnce(11);

    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([10]);

    h.boardEl.dispatchEvent(pointerEvent("pointermove", { clientX: 2 }));
    expect(h.path.get()).toEqual([10, 11]);

    h.boardEl.dispatchEvent(pointerEvent("pointerup"));
    expect(h.onSubmit).toHaveBeenCalledTimes(2);
    h.detach();
  });

  it("a second pointerdown mid-gesture doesn't corrupt state (multi-touch guard)", () => {
    const h = mount({ capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1 }));

    // Second finger lands while first is still down.
    h.capUnderPoint.mockReturnValue(5);
    h.boardEl.dispatchEvent(pointerEvent("pointerdown", { pointerId: 2 }));

    // Whatever the strategy is (accept or ignore), the gesture must
    // still cleanly terminate on pointerup and leave a sane path.
    h.boardEl.dispatchEvent(pointerEvent("pointerup", { pointerId: 1 }));
    h.boardEl.dispatchEvent(pointerEvent("pointerup", { pointerId: 2 }));

    // After all pointers up, another drag should work.
    h.path.clear();
    h.capUnderPoint.mockReturnValue(2);
    h.boardEl.dispatchEvent(pointerEvent("pointerdown", { pointerId: 3 }));
    expect(h.path.get()).toEqual([2]);
    h.detach();
  });
});

describe("attachInput — outside-tap clears the path", () => {
  it("clears when tapping a neutral element outside the board", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);

    const outside = document.createElement("section");
    document.body.appendChild(outside);
    outside.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([]);
    h.detach();
  });

  it("does not clear when the tap target is inside the board", () => {
    const h = mount({ capUnder: () => 5 });
    h.path.push(0);

    const child = document.createElement("span");
    h.boardEl.appendChild(child);
    child.dispatchEvent(pointerEvent("pointerdown"));
    // The board's own pointerdown handler fires too (bubbled), but
    // the doc listener should not clear on its own.
    expect(h.path.get().length).toBeGreaterThan(0);
    h.detach();
  });

  it("does not clear when the tap target is inside the wordBar", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);

    const btn = document.createElement("span");
    h.wordBarEl.appendChild(btn);
    btn.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([0, 1]);
    h.detach();
  });

  it("does not clear when the tap target is an interactive control", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);

    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([0, 1]);
    h.detach();
  });

  it("does not clear when phase is not playing", () => {
    const h = mount({ phase: "results" });
    h.path.push(0);

    const outside = document.createElement("section");
    document.body.appendChild(outside);
    outside.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([0]);
    h.detach();
  });

  it("is a no-op when the path is already empty", () => {
    const h = mount();
    const sub = vi.fn();
    const unsub = h.path.subscribe(sub);
    sub.mockClear();

    const outside = document.createElement("section");
    document.body.appendChild(outside);
    outside.dispatchEvent(pointerEvent("pointerdown"));
    // No path writes → no subscriber calls.
    expect(sub).not.toHaveBeenCalled();
    unsub();
    h.detach();
  });
});

describe("attachInput — keyboard", () => {
  it("typing letters builds a path via the resolver", () => {
    const h = mount();
    window.dispatchEvent(keyEvent("keydown", { key: "c" }));
    window.dispatchEvent(keyEvent("keydown", { key: "a" }));
    window.dispatchEvent(keyEvent("keydown", { key: "t" }));
    expect(h.path.wordText(BOARD)).toBe("cat");
    h.detach();
  });

  it("Enter submits when the path is non-empty", () => {
    const h = mount();
    h.path.push(0);
    window.dispatchEvent(keyEvent("keydown", { key: "Enter" }));
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    h.detach();
  });

  it("Enter is a no-op when the path is empty", () => {
    const h = mount();
    window.dispatchEvent(keyEvent("keydown", { key: "Enter" }));
    expect(h.onSubmit).not.toHaveBeenCalled();
    h.detach();
  });

  it("Backspace without a typed buffer pops the path", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);
    window.dispatchEvent(keyEvent("keydown", { key: "Backspace" }));
    expect(h.path.get()).toEqual([0]);
    h.detach();
  });

  it("Backspace with a typed buffer shrinks the typed word, not the path directly", () => {
    const h = mount();
    window.dispatchEvent(keyEvent("keydown", { key: "c" }));
    window.dispatchEvent(keyEvent("keydown", { key: "a" }));
    window.dispatchEvent(keyEvent("keydown", { key: "t" }));
    expect(h.path.wordText(BOARD)).toBe("cat");
    window.dispatchEvent(keyEvent("keydown", { key: "Backspace" }));
    expect(h.path.wordText(BOARD)).toBe("ca");
    h.detach();
  });

  it("Escape clears the path during play", () => {
    const h = mount();
    h.path.push(0);
    h.path.push(1);
    window.dispatchEvent(keyEvent("keydown", { key: "Escape" }));
    expect(h.path.get()).toEqual([]);
    h.detach();
  });

  it("Escape does nothing when phase is not playing", () => {
    const h = mount({ phase: "results" });
    h.path.push(0);
    window.dispatchEvent(keyEvent("keydown", { key: "Escape" }));
    // path untouched because the handler early-returns on non-play.
    expect(h.path.get()).toEqual([0]);
    h.detach();
  });

  it("letter keys are ignored when focus is inside a text input", () => {
    const h = mount();
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(keyEvent("keydown", { key: "c" }));
    expect(h.path.get()).toEqual([]);
    h.detach();
  });

  it("letter keys with modifier keys are ignored", () => {
    const h = mount();
    window.dispatchEvent(keyEvent("keydown", { key: "c", ctrlKey: true }));
    window.dispatchEvent(keyEvent("keydown", { key: "c", metaKey: true }));
    window.dispatchEvent(keyEvent("keydown", { key: "c", altKey: true }));
    expect(h.path.get()).toEqual([]);
    h.detach();
  });

  it("non-alphabetic single-character keys are ignored", () => {
    const h = mount();
    window.dispatchEvent(keyEvent("keydown", { key: "1" }));
    window.dispatchEvent(keyEvent("keydown", { key: "-" }));
    window.dispatchEvent(keyEvent("keydown", { key: " " }));
    expect(h.path.get()).toEqual([]);
    h.detach();
  });

  it("seeds the typed buffer from the current path when the user starts typing mid-gesture", () => {
    const h = mount();
    // Start path via pointer, then switch to keyboard.
    h.path.push(0); // C
    window.dispatchEvent(keyEvent("keydown", { key: "a" }));
    // Path should now spell "ca" rather than throwing away the "c".
    expect(h.path.wordText(BOARD)).toBe("ca");
    h.detach();
  });

  it("rejects letters that don't extend to a valid path and keeps the previous buffer", () => {
    const h = mount();
    window.dispatchEvent(keyEvent("keydown", { key: "c" }));
    window.dispatchEvent(keyEvent("keydown", { key: "a" }));
    // "caz" doesn't exist on the board — the "z" should be rejected
    // without corrupting the "ca" state.
    window.dispatchEvent(keyEvent("keydown", { key: "z" }));
    expect(h.path.wordText(BOARD)).toBe("ca");
    h.detach();
  });
});

describe("attachInput — phase transitions", () => {
  it("pointer input is inert before playing and becomes live after", () => {
    const h = mount({ phase: "lobby", capUnder: () => 0 });
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([]);

    h.getPhase.mockReturnValue("playing");
    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(h.path.get()).toEqual([0]);
    h.detach();
  });

  it("keyboard input is inert outside playing phase", () => {
    const h = mount({ phase: "results" });
    window.dispatchEvent(keyEvent("keydown", { key: "c" }));
    expect(h.path.get()).toEqual([]);
    h.detach();
  });
});

describe("attachInput — teardown", () => {
  it("removes all listeners on detach", () => {
    const h = mount({ capUnder: () => 0 });
    h.detach();

    h.boardEl.dispatchEvent(pointerEvent("pointerdown"));
    window.dispatchEvent(keyEvent("keydown", { key: "c" }));
    // Nothing changed after detach.
    expect(h.path.get()).toEqual([]);
    expect(h.onPress).not.toHaveBeenCalled();
  });

  it("detach is idempotent", () => {
    const h = mount();
    expect(() => {
      h.detach();
      h.detach();
    }).not.toThrow();
  });

  it("a mid-gesture detach aborts cleanly; re-attach resumes input on next gesture", () => {
    // Regression: Room.svelte used to detach+reattach attachInput on
    // every room state update (score ticks, ready flags, etc.). If
    // that happened mid-drag, the new attachInput's pointerActive
    // flag was false and subsequent pointermove events did nothing
    // until the user lifted and tapped again. The Room-side fix is
    // to only re-run on phase changes, but attachInput itself must
    // tolerate being detached mid-gesture.

    // Start a gesture on instance A.
    const path = createPathStore();
    const boardEl = document.createElement("div");
    const wordBarEl = document.createElement("div");
    document.body.append(boardEl, wordBarEl);

    const makeHarness = () => {
      const onSubmit = vi.fn();
      const onPress = vi.fn();
      const capUnder = vi.fn(() => 0);
      const capNear = vi.fn(() => -1);
      const detach = attachInput({
        boardEl,
        wordBarEl,
        path,
        onSubmit,
        getBoard: () => BOARD,
        getPhase: () => "playing",
        onPress,
        findCapUnderPoint: capUnder,
        findCapNearPoint: capNear,
      });
      return { onSubmit, onPress, capUnder, capNear, detach };
    };

    const a = makeHarness();
    boardEl.dispatchEvent(pointerEvent("pointerdown"));
    expect(path.get()).toEqual([0]);

    // Mid-gesture detach (simulating Room effect re-firing).
    a.detach();

    // Pointer events that would have extended the drag now go nowhere.
    a.capNear.mockReturnValue(1);
    boardEl.dispatchEvent(pointerEvent("pointermove"));
    expect(path.get()).toEqual([0]); // unchanged — listeners gone

    // A fresh attachInput takes over. The next gesture must work
    // without requiring the user to lift and re-tap twice.
    const b = makeHarness();
    b.capUnder.mockReturnValue(2);
    boardEl.dispatchEvent(pointerEvent("pointerdown"));
    // Path shared across instances — tapping a non-adjacent tile
    // resets it, same as fresh input.
    expect(path.get()).toEqual([2]);

    b.capNear.mockReturnValue(6);
    boardEl.dispatchEvent(pointerEvent("pointermove"));
    expect(path.get()).toEqual([2, 6]);

    boardEl.dispatchEvent(pointerEvent("pointerup"));
    expect(b.onSubmit).toHaveBeenCalledTimes(1);

    b.detach();
  });
});
