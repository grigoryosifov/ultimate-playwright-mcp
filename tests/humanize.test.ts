/**
 * Unit tests for the human-behaviour primitives.
 *
 * These cover the parts that are pure or driveable with a fake mouse/keyboard.
 * The Playwright integration in src/browser/human/index.ts needs a live CDP
 * endpoint and is smoke-tested manually.
 */

import { describe, it, expect } from "vitest";
import { resolveConfig, type HumanConfig } from "../src/browser/human/config.js";
import {
  bezier,
  clickTarget,
  easeInOut,
  humanMove,
  randomControlPoints,
  type Point,
} from "../src/browser/human/mouse.js";
import {
  getNearbyKey,
  interCharDelay,
  isAscii,
  planTyping,
  runPlan,
  type KeyOp,
} from "../src/browser/human/keyboard.js";

/** Records every move instead of driving a real mouse. */
function fakeMouse() {
  const moves: Point[] = [];
  return {
    moves,
    raw: {
      move: async (x: number, y: number) => {
        moves.push({ x, y });
      },
    },
  };
}

/** Replay a typing plan the way a text field would apply it. */
function replay(ops: KeyOp[]): string {
  const buf: string[] = [];
  for (const op of ops) {
    if (op.kind === "insert") {
      buf.push(op.text);
    } else if (op.kind === "press") {
      if (op.key === "Backspace") buf.pop();
      else if (op.key === "Enter") buf.push("\n");
      else buf.push(op.key);
    }
  }
  return buf.join("");
}

/** Fast config: no burst pauses, so movement tests do not sleep. */
function fastConfig(overrides: Partial<HumanConfig> = {}): HumanConfig {
  return resolveConfig("default", { mouse_burst_pause: [0, 0], ...overrides });
}

describe("config", () => {
  it("exposes both presets and careful is slower than default", () => {
    const d = resolveConfig("default");
    const c = resolveConfig("careful");
    expect(c.typing_delay).toBeGreaterThan(d.typing_delay);
    expect(c.click_aim_delay_button[0]).toBeGreaterThan(d.click_aim_delay_button[0]);
  });

  it("applies overrides without mutating the preset", () => {
    const custom = resolveConfig("default", { typing_delay: 5 });
    expect(custom.typing_delay).toBe(5);
    expect(resolveConfig("default").typing_delay).toBe(70);
  });

  it("rejects an unknown preset", () => {
    expect(() => resolveConfig("turbo" as never)).toThrow(/Unknown humanize preset/);
  });
});

describe("bezier / easing", () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 40 };
  const p2 = { x: 60, y: -20 };
  const p3 = { x: 100, y: 0 };

  it("starts at p0 and ends at p3", () => {
    expect(bezier(p0, p1, p2, p3, 0)).toEqual(p0);
    const end = bezier(p0, p1, p2, p3, 1);
    expect(end.x).toBeCloseTo(p3.x);
    expect(end.y).toBeCloseTo(p3.y);
  });

  it("eases from 0 to 1 monotonically", () => {
    expect(easeInOut(0)).toBeCloseTo(0);
    expect(easeInOut(1)).toBeCloseTo(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOut(Math.min(t, 1));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("offsets control points off the straight line", () => {
    // Perpendicular bias on a horizontal move shows up in y.
    const offsets = Array.from({ length: 20 }, () => {
      const [c1, c2] = randomControlPoints({ x: 0, y: 0 }, { x: 500, y: 0 });
      return Math.max(Math.abs(c1.y), Math.abs(c2.y));
    });
    expect(Math.max(...offsets)).toBeGreaterThan(1);
  });
});

describe("humanMove", () => {
  it("does nothing for a sub-pixel move", async () => {
    const { moves, raw } = fakeMouse();
    await humanMove(raw, 100, 100, 100.4, 100.2, fastConfig());
    expect(moves).toEqual([]);
  });

  it("emits many interpolated steps rather than one jump", async () => {
    const { moves, raw } = fakeMouse();
    const cfg = fastConfig();
    await humanMove(raw, 0, 0, 500, 0, cfg);
    // dist 500 / divisor 8 => 63 steps, clamped into [25, 80], +1 for step 0.
    expect(moves.length).toBeGreaterThanOrEqual(cfg.mouse_min_steps + 1);
    expect(moves.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(moves.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))).toBe(true);
  });

  it("arrives at the target", async () => {
    const { moves, raw } = fakeMouse();
    await humanMove(raw, 0, 0, 420, 260, fastConfig({ mouse_overshoot_chance: 0 }));
    const last = moves[moves.length - 1];
    expect(Math.abs(last.x - 420)).toBeLessThanOrEqual(2);
    expect(Math.abs(last.y - 260)).toBeLessThanOrEqual(2);
  });

  it("lands near the target even when it overshoots first", async () => {
    const { moves, raw } = fakeMouse();
    await humanMove(raw, 0, 0, 300, 0, fastConfig({ mouse_overshoot_chance: 1 }));
    const last = moves[moves.length - 1];
    // Overshoot is always followed by a correction back onto the target.
    expect(Math.abs(last.x - 300)).toBeLessThanOrEqual(3);
    expect(Math.abs(last.y)).toBeLessThanOrEqual(3);
  });

  it("does not travel in a straight line", async () => {
    const { moves, raw } = fakeMouse();
    await humanMove(raw, 0, 0, 500, 0, fastConfig({ mouse_overshoot_chance: 0 }));
    // A straight horizontal path would keep y at 0 the whole way.
    const maxDeviation = Math.max(...moves.map((p) => Math.abs(p.y)));
    expect(maxDeviation).toBeGreaterThan(1);
  });
});

describe("clickTarget", () => {
  const box = { x: 100, y: 200, width: 300, height: 40 };
  const cfg = resolveConfig("default");

  it("always aims inside the element", () => {
    for (let i = 0; i < 200; i++) {
      const p = clickTarget(box, i % 2 === 0, cfg);
      expect(p.x).toBeGreaterThanOrEqual(box.x);
      expect(p.x).toBeLessThanOrEqual(box.x + box.width);
      expect(p.y).toBeGreaterThanOrEqual(box.y);
      expect(p.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it("aims text inputs near the left, where the caret goes", () => {
    for (let i = 0; i < 100; i++) {
      const p = clickTarget(box, true, cfg);
      expect(p.x).toBeLessThan(box.x + box.width * 0.35);
    }
  });

  it("does not repeatedly hit the exact centre of a button", () => {
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const points = Array.from({ length: 50 }, () => clickTarget(box, false, cfg));
    const exact = points.filter((p) => p.x === centre.x && p.y === centre.y);
    expect(exact.length).toBe(0);
    // and the aim points must actually vary
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThan(10);
  });
});

describe("planTyping", () => {
  it("reproduces the text exactly with typos disabled", () => {
    const cfg = resolveConfig("default", { mistype_chance: 0 });
    const text = "Hello, world! 42";
    expect(replay(planTyping(text, cfg))).toBe(text);
  });

  it("still reproduces the text exactly when every character is mistyped", () => {
    const cfg = resolveConfig("default", { mistype_chance: 1 });
    const text = "growth42";
    const ops = planTyping(text, cfg);
    expect(replay(ops)).toBe(text);
    // Each alphanumeric character should have produced a correction pair.
    const backspaces = ops.filter((o) => o.kind === "press" && o.key === "Backspace");
    expect(backspaces.length).toBe(text.length);
  });

  it("handles non-ASCII via insertText (Cyrillic, emoji)", () => {
    const cfg = resolveConfig("default", { mistype_chance: 0 });
    const text = "Здравей 👋";
    const ops = planTyping(text, cfg);
    expect(replay(ops)).toBe(text);
    expect(ops.some((o) => o.kind === "insert")).toBe(true);
  });

  it("maps newlines to Enter presses", () => {
    const cfg = resolveConfig("default", { mistype_chance: 0 });
    const ops = planTyping("a\nb", cfg);
    expect(ops.some((o) => o.kind === "press" && o.key === "Enter")).toBe(true);
    expect(replay(ops)).toBe("a\nb");
  });

  it("gives every keystroke a non-zero hold and a varied gap", () => {
    const cfg = resolveConfig("default", { mistype_chance: 0, typing_pause_chance: 0 });
    const ops = planTyping("abcdefghijklmnop", cfg);
    const holds = ops.filter((o) => o.kind === "press").map((o) => (o as { holdMs: number }).holdMs);
    expect(holds.every((h) => h >= cfg.key_hold[0] && h <= cfg.key_hold[1])).toBe(true);
    const gaps = ops.filter((o) => o.kind === "wait").map((o) => (o as { ms: number }).ms);
    // Not a metronome: the gaps must not all be identical.
    expect(new Set(gaps.map((g) => Math.round(g))).size).toBeGreaterThan(1);
  });

  it("emits nothing for empty text", () => {
    expect(planTyping("", resolveConfig("default"))).toEqual([]);
  });
});

describe("interCharDelay", () => {
  it("stays within the configured spread when pauses are disabled", () => {
    const cfg = resolveConfig("default", { typing_pause_chance: 0 });
    for (let i = 0; i < 200; i++) {
      const d = interCharDelay(cfg);
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(cfg.typing_delay + cfg.typing_delay_spread);
    }
  });

  it("produces long think-pauses when they are always on", () => {
    const cfg = resolveConfig("default", { typing_pause_chance: 1 });
    const d = interCharDelay(cfg);
    expect(d).toBeGreaterThanOrEqual(cfg.typing_pause_range[0]);
    expect(d).toBeLessThanOrEqual(cfg.typing_pause_range[1]);
  });
});

describe("keyboard helpers", () => {
  it("classifies ASCII vs non-ASCII", () => {
    expect(isAscii("a")).toBe(true);
    expect(isAscii("~")).toBe(true);
    expect(isAscii("щ")).toBe(false);
    expect(isAscii("👋")).toBe(false);
  });

  it("picks an adjacent key for a typo, never the intended one", () => {
    for (let i = 0; i < 50; i++) {
      const wrong = getNearbyKey("g");
      expect(wrong).not.toBe("g");
      expect("fhtyb").toContain(wrong);
    }
  });

  it("preserves case when mistyping an uppercase letter", () => {
    const wrong = getNearbyKey("G");
    expect(wrong).toBe(wrong.toUpperCase());
  });
});

describe("runPlan", () => {
  it("drives the keyboard in order, forwarding holds as press delays", async () => {
    const calls: string[] = [];
    const keyboard = {
      press: async (key: string, options?: { delay?: number }) => {
        calls.push(`press:${key}:${options?.delay ?? 0}`);
      },
      insertText: async (text: string) => {
        calls.push(`insert:${text}`);
      },
    };
    await runPlan(keyboard, [
      { kind: "press", key: "a", holdMs: 20 },
      { kind: "wait", ms: 1 },
      { kind: "insert", text: "щ" },
    ]);
    expect(calls).toEqual(["press:a:20", "insert:щ"]);
  });
});
