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

/**
 * Move the cursor to a human aim point inside `locator`, then click it.
 *
 * Returns false when the element has no usable box (detached, zero-size,
 * display:none) so the caller can fall back to a plain Playwright click rather
 * than failing outright.
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
  const cfg = resolveConfig(opts.preset);

  let box: BoundingBox | null = null;
  try {
    await locator.waitFor({ state: "visible", timeout: opts.timeout });
    await locator.scrollIntoViewIfNeeded({ timeout: opts.timeout });
    box = await locator.boundingBox({ timeout: opts.timeout });
  } catch {
    return false;
  }
  if (!box || box.width <= 0 || box.height <= 0) {
    return false;
  }

  const isInput = await looksLikeTextInput(locator);
  const target = clickTarget(box, isInput, cfg);

  const cursor = getCursor(page, cfg);
  await humanMove(page.mouse, cursor.x, cursor.y, target.x, target.y, cfg);
  setCursor(page, target);

  // Pause between arriving and pressing, the way a hand settles on a target.
  await sleep(aimDelay(cfg, isInput));

  // Playwright re-resolves the element and interprets `position` against its
  // current box, so a late reflow cannot make us click the wrong pixel.
  const position = { x: target.x - box.x, y: target.y - box.y };
  const clickOpts = {
    position,
    delay: clickHold(cfg, isInput),
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
  }

  await runPlan(page.keyboard, planTyping(text, cfg));
  return true;
}
