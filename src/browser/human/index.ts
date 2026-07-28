/**
 * Playwright integration for the human-behaviour primitives.
 *
 * Builds on CloakBrowser's MIT-licensed timing model (see ./mouse.ts and
 * ./keyboard.ts) but keeps Playwright in charge of the actual press: the cursor
 * is walked to a randomised aim point inside the element, then the real
 * locator.click()/dblclick() runs with `position` and `delay` set. That way all
 * of Playwright's actionability checks (visible, stable, enabled, receives
 * events) still apply — we change how the input looks, never whether it lands.
 */

import type { Locator, Page } from "playwright-core";
import {
  HumanConfig,
  HumanPreset,
  rand,
  resolveConfig,
  sleep,
} from "./config.js";
import { BoundingBox, clickTarget, humanMove, Point } from "./mouse.js";
import { aimDelay, clickHold, planTyping, runPlan } from "./keyboard.js";

export type { HumanConfig, HumanPreset } from "./config.js";
export { resolveConfig } from "./config.js";

export type MouseButton = "left" | "right" | "middle";
export type KeyModifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";

/**
 * Last known cursor position per page. Playwright exposes no getter for it, so
 * we track our own — without it every move would have to start from an assumed
 * origin and the paths would all share a suspicious common start point.
 */
const cursorPositions = new WeakMap<Page, Point>();

function getCursor(page: Page, cfg: HumanConfig): Point {
  const existing = cursorPositions.get(page);
  if (existing) return existing;
  // First interaction on this page: start somewhere plausible near the top of
  // the viewport, as if the cursor came down from the browser chrome.
  const start: Point = {
    x: rand(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1]),
    y: rand(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1]),
  };
  cursorPositions.set(page, start);
  return start;
}

function setCursor(page: Page, point: Point): void {
  cursorPositions.set(page, point);
}

/** Reset tracked cursor state — exported for tests. */
export function forgetCursor(page: Page): void {
  cursorPositions.delete(page);
}

async function looksLikeTextInput(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((el: unknown) => {
      const node = el as { tagName?: string; isContentEditable?: boolean };
      const tag = (node.tagName || "").toUpperCase();
      return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable === true;
    });
  } catch {
    return false;
  }
}

type Approach = {
  cfg: HumanConfig;
  box: BoundingBox;
  target: Point;
  isInput: boolean;
  /** Aim point relative to the element's top-left, for Playwright's `position`. */
  position: { x: number; y: number };
};

/**
 * Walk the cursor to a human aim point inside `locator`.
 *
 * Shared by click and hover: both need the same "get there like a person would"
 * step, and only differ in what they do on arrival. Returns null when the
 * element has no usable box (detached, zero-size, display:none) so callers can
 * fall back to plain Playwright rather than failing outright.
 */
async function approach(
  page: Page,
  locator: Locator,
  opts: { timeout: number; preset?: HumanPreset },
): Promise<Approach | null> {
  const cfg = resolveConfig(opts.preset);

  let box: BoundingBox | null = null;
  try {
    await locator.waitFor({ state: "visible", timeout: opts.timeout });
    await locator.scrollIntoViewIfNeeded({ timeout: opts.timeout });
    box = await locator.boundingBox({ timeout: opts.timeout });
  } catch {
    return null;
  }
  if (!box || box.width <= 0 || box.height <= 0) {
    return null;
  }

  const isInput = await looksLikeTextInput(locator);
  const target = clickTarget(box, isInput, cfg);

  const cursor = getCursor(page, cfg);
  await humanMove(page.mouse, cursor.x, cursor.y, target.x, target.y, cfg);
  setCursor(page, target);

  return {
    cfg,
    box,
    target,
    isInput,
    position: { x: target.x - box.x, y: target.y - box.y },
  };
}

/**
 * Move the cursor to a human aim point inside `locator`, then click it.
 *
 * Returns false when the element has no usable box, so the caller can fall back
 * to a plain Playwright click.
 */
export async function humanClick(
  page: Page,
  locator: Locator,
  opts: {
    timeout: number;
    button?: MouseButton;
    modifiers?: KeyModifier[];
    doubleClick?: boolean;
    preset?: HumanPreset;
  },
): Promise<boolean> {
  const arrival = await approach(page, locator, {
    timeout: opts.timeout,
    preset: opts.preset,
  });
  if (!arrival) return false;

  // Pause between arriving and pressing, the way a hand settles on a target.
  await sleep(aimDelay(arrival.cfg, arrival.isInput));

  // Playwright re-resolves the element and interprets `position` against its
  // current box, so a late reflow cannot make us click the wrong pixel.
  const clickOpts = {
    position: arrival.position,
    delay: clickHold(arrival.cfg, arrival.isInput),
    button: opts.button,
    modifiers: opts.modifiers,
    timeout: opts.timeout,
  };

  if (opts.doubleClick) {
    await locator.dblclick(clickOpts);
  } else {
    await locator.click(clickOpts);
  }
  return true;
}

/**
 * Move the cursor to a human aim point inside `locator` and rest there.
 *
 * Worth humanizing for the same reason as click: a hover that teleports onto a
 * menu trigger and fires instantly is a distinctive pattern, and some menus key
 * off a dwell rather than the first pixel of contact — so arriving along a path
 * and settling briefly is both more realistic and more likely to work.
 *
 * Returns false when the element has no usable box.
 */
export async function humanHover(
  page: Page,
  locator: Locator,
  opts: { timeout: number; preset?: HumanPreset },
): Promise<boolean> {
  const arrival = await approach(page, locator, opts);
  if (!arrival) return false;

  await sleep(aimDelay(arrival.cfg, arrival.isInput));
  await locator.hover({ position: arrival.position, timeout: opts.timeout });
  return true;
}

/**
 * Collapse the caret to the very end of an editable element, so subsequent
 * typing appends instead of landing wherever the focus click happened to
 * place it. Runs in page context via locator.evaluate. Handles both
 * <input>/<textarea> (setSelectionRange) and contenteditable roots
 * (Range collapsed to the end of the content).
 *
 * Selection placement is not an input event, so nothing that profiles typing
 * cadence sees it — the keystrokes that follow are the human-shaped part.
 */
export function collapseCaretToEnd(el: Element): void {
  if (typeof el.setSelectionRange === "function" && typeof el.value === "string") {
    try {
      const len = el.value.length;
      el.setSelectionRange(len, len);
      return;
    } catch {
      // Some input types (number, email) reject setSelectionRange — fall
      // through to the generic selection path.
    }
  }
  const doc = el.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return;
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = win.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Focus `locator` with a human click, optionally clear it, then type `text`
 * with human cadence.
 *
 * Returns false if the element could not be focused via the human path, so the
 * caller can fall back to Playwright's own click+type.
 */
export async function humanType(
  page: Page,
  locator: Locator,
  text: string,
  opts: {
    timeout: number;
    clear?: boolean;
    /**
     * Move the caret to the end of the existing content after focusing.
     * The focus click lands at a randomised point inside the element, so
     * without this, appended text would splice into the middle of whatever
     * is already there.
     */
    caretToEnd?: boolean;
    preset?: HumanPreset;
  },
): Promise<boolean> {
  const cfg = resolveConfig(opts.preset);

  const focused = await humanClick(page, locator, {
    timeout: opts.timeout,
    preset: opts.preset,
  });
  if (!focused) {
    return false;
  }

  if (opts.clear) {
    // Select-all + Delete rather than fill(""), so clearing also goes through
    // real key events instead of setting .value directly.
    await page.keyboard.press("ControlOrMeta+a");
    await sleep(rand(40, 120));
    await page.keyboard.press("Delete");
    await sleep(rand(80, 200));
  } else if (opts.caretToEnd) {
    await locator.evaluate(collapseCaretToEnd);
    await sleep(rand(40, 120));
  }

  await runPlan(page.keyboard, planTyping(text, cfg));
  return true;
}
