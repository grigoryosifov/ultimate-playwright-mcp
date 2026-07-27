/**
 * Human-like typing cadence.
 *
 * Adapted from CloakBrowser's MIT-licensed wrapper (js/src/human/keyboard.ts),
 * https://github.com/CloakHQ/CloakBrowser — Copyright (c) 2026 CloakHQ, MIT.
 *
 * Adapted rather than vendored: CloakBrowser hand-rolls shift handling and
 * reaches for CDP Input.dispatchKeyEvent to type shifted symbols. Playwright's
 * keyboard.press() already maps characters (including uppercase and symbols) to
 * real key events with a settable keydown-to-keyup hold, so we drive that
 * instead and keep only the timing model: per-key hold, jittered inter-key
 * gaps, occasional thinking pauses, and a small typo-then-correct rate.
 *
 * Typing is emitted as a plan of primitive ops so the cadence model is unit
 * testable without a browser.
 */

import { HumanConfig, rand, randRange, sleep } from "./config.js";

export type KeyOp =
  /** keyboard.press(key, { delay: holdMs }) — a real keydown/keyup pair. */
  | { kind: "press"; key: string; holdMs: number }
  /** keyboard.insertText(text) — for characters Playwright cannot key-map. */
  | { kind: "insert"; text: string }
  /** Pause between ops. */
  | { kind: "wait"; ms: number };

/** QWERTY neighbours, used to make a simulated typo land on an adjacent key. */
const NEARBY_KEYS: Record<string, string> = {
  a: "sqwz", b: "vghn", c: "xdfv", d: "sfecx", e: "wrsdf",
  f: "dgrtcv", g: "fhtyb", h: "gjybn", i: "ujko", j: "hkunm",
  k: "jloi", l: "kop", m: "njk", n: "bhjm", o: "iklp",
  p: "ol", q: "wa", r: "edft", s: "awedxz", t: "rfgy",
  u: "yhji", v: "cfgb", w: "qase", x: "zsdc", y: "tghu",
  z: "asx",
  "1": "2q", "2": "13qw", "3": "24we", "4": "35er", "5": "46rt",
  "6": "57ty", "7": "68yu", "8": "79ui", "9": "80io", "0": "9p",
};

export function isAscii(ch: string): boolean {
  const code = ch.codePointAt(0);
  return code !== undefined && code < 128;
}

/** Pick a plausible wrong key adjacent to the intended one. */
export function getNearbyKey(ch: string): string {
  const lower = ch.toLowerCase();
  const neighbors = NEARBY_KEYS[lower];
  if (!neighbors) return ch;
  const wrong = neighbors[Math.floor(Math.random() * neighbors.length)];
  return ch !== lower ? wrong.toUpperCase() : wrong;
}

/** Gap between two consecutive keystrokes, occasionally a longer think-pause. */
export function interCharDelay(cfg: HumanConfig): number {
  if (Math.random() < cfg.typing_pause_chance) {
    return randRange(cfg.typing_pause_range);
  }
  const delay = cfg.typing_delay + (Math.random() - 0.5) * 2 * cfg.typing_delay_spread;
  return Math.max(10, delay);
}

/**
 * Build the full op sequence for typing `text`.
 *
 * Pure apart from Math.random, so tests can pin mistype_chance to 0 or 1 and
 * assert the resulting text by replaying the plan.
 */
export function planTyping(text: string, cfg: HumanConfig): KeyOp[] {
  const chars = [...text]; // code points, so emoji/surrogate pairs stay intact
  const ops: KeyOp[] = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (ch === "\n" || ch === "\r") {
      ops.push({ kind: "press", key: "Enter", holdMs: randRange(cfg.key_hold) });
    } else if (!isAscii(ch)) {
      // Cyrillic, CJK, emoji: no key mapping exists, so insert the text
      // directly but keep the timing shape of a keystroke.
      ops.push({ kind: "wait", ms: randRange(cfg.key_hold) });
      ops.push({ kind: "insert", text: ch });
    } else {
      if (Math.random() < cfg.mistype_chance && /^[a-zA-Z0-9]$/.test(ch)) {
        ops.push({ kind: "press", key: getNearbyKey(ch), holdMs: randRange(cfg.key_hold) });
        ops.push({ kind: "wait", ms: randRange(cfg.mistype_delay_notice) });
        ops.push({ kind: "press", key: "Backspace", holdMs: randRange(cfg.key_hold) });
        ops.push({ kind: "wait", ms: randRange(cfg.mistype_delay_correct) });
      }
      ops.push({ kind: "press", key: ch, holdMs: randRange(cfg.key_hold) });
    }

    if (i < chars.length - 1) {
      ops.push({ kind: "wait", ms: interCharDelay(cfg) });
    }
  }

  return ops;
}

/** The subset of Playwright's Keyboard we drive. */
export interface RawKeyboard {
  press: (key: string, options?: { delay?: number }) => Promise<void>;
  insertText: (text: string) => Promise<void>;
}

/** Execute a typing plan against a keyboard. */
export async function runPlan(keyboard: RawKeyboard, ops: KeyOp[]): Promise<void> {
  for (const op of ops) {
    if (op.kind === "wait") {
      await sleep(op.ms);
    } else if (op.kind === "insert") {
      await keyboard.insertText(op.text);
    } else {
      await keyboard.press(op.key, { delay: op.holdMs });
    }
  }
}

/** Delay a human spends aiming before pressing, once the cursor has arrived. */
export function aimDelay(cfg: HumanConfig, isInput: boolean): number {
  return randRange(isInput ? cfg.click_aim_delay_input : cfg.click_aim_delay_button);
}

/** How long the mouse button stays down. */
export function clickHold(cfg: HumanConfig, isInput: boolean): number {
  return randRange(isInput ? cfg.click_hold_input : cfg.click_hold_button);
}

export { rand };
