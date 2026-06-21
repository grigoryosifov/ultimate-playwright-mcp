/**
 * Extracted from OpenClaw (https://github.com/openclaw/openclaw)
 * Original: src/browser/pw-tools-core.interactions.ts
 * License: MIT
 */

import {
  ensurePageState,
  getPageForTargetId,
  refLocator,
  restoreRoleRefsForTarget,
} from "./pw-session.js";
import { normalizeTimeoutMs, requireRef, toAIFriendlyError } from "./pw-tools-shared.js";

export type BrowserFormField = {
  ref: string;
  type: string;
  value?: string | number | boolean;
};

export async function highlightViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref: string;
}): Promise<void> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const ref = requireRef(opts.ref);
  try {
    await refLocator(page, ref).highlight();
  } catch (err) {
    throw toAIFriendlyError(err, ref);
  }
}

export async function clickViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref: string;
  doubleClick?: boolean;
  button?: "left" | "right" | "middle";
  modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">;
  timeoutMs?: number;
}): Promise<void> {
  const page = await getPageForTargetId({
    cdpUrl: opts.cdpUrl,
    targetId: opts.targetId,
  });
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const ref = requireRef(opts.ref);
  const locator = refLocator(page, ref);
  const timeout = Math.max(500, Math.min(60_000, Math.floor(opts.timeoutMs ?? 8000)));
  try {
    if (opts.doubleClick) {
      await locator.dblclick({
        timeout,
        button: opts.button,
        modifiers: opts.modifiers,
      });
    } else {
      await locator.click({
        timeout,
        button: opts.button,
        modifiers: opts.modifiers,
      });
    }
  } catch (err) {
    throw toAIFriendlyError(err, ref);
  }
}

export async function hoverViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref: string;
  timeoutMs?: number;
}): Promise<void> {
  const ref = requireRef(opts.ref);
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  try {
    await refLocator(page, ref).hover({
      timeout: Math.max(500, Math.min(60_000, opts.timeoutMs ?? 8000)),
    });
  } catch (err) {
    throw toAIFriendlyError(err, ref);
  }
}

export async function dragViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  startRef: string;
  endRef: string;
  /**
   * Strategy for the drag:
   * - "auto" (default): detect native HTML5 drag-and-drop (a draggable source)
   *   and dispatch drag events with a real DataTransfer; otherwise use the
   *   mouse-based dragTo for pointer/JS libraries.
   * - "mouse": force Playwright's mouse-based dragTo (MUI, dnd-kit, SortableJS…).
   * - "native": force the HTML5 DataTransfer event dispatch (Chromium/Firefox only).
   */
  mode?: "auto" | "mouse" | "native";
  timeoutMs?: number;
}): Promise<{ mode: "mouse" | "native" }> {
  const startRef = requireRef(opts.startRef);
  const endRef = requireRef(opts.endRef);
  const mode = opts.mode ?? "auto";
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 8000);
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });

  const start = refLocator(page, startRef);
  const end = refLocator(page, endRef);

  // Decide whether to use the native HTML5 path. Playwright's mouse-based
  // dragTo() synthesizes trusted mouse events that carry NO DataTransfer, so it
  // silently no-ops on native HTML5 drag-and-drop (draggable="true", or
  // default-draggable <a>/<img>, all of which report element.draggable === true).
  // For those, dispatch the drag events with a real DataTransfer instead.
  let useNative = mode === "native";
  if (mode === "auto") {
    try {
      useNative = await start.evaluate(
        (el: unknown) => (el as { draggable?: boolean }).draggable === true
      );
    } catch {
      useNative = false;
    }
  }

  try {
    if (useNative) {
      const startHandle = await start.elementHandle({ timeout });
      const endHandle = await end.elementHandle({ timeout });
      if (!startHandle || !endHandle) {
        throw new Error("could not resolve drag source/target elements");
      }
      try {
        await page.evaluate(
          ({ src, dst }: { src: unknown; dst: unknown }) => {
            const w = window as unknown as {
              DataTransfer: new () => unknown;
              DragEvent: new (type: string, init: unknown) => Event;
            };
            const dt = new w.DataTransfer();
            const fire = (el: unknown, type: string) =>
              (el as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(
                new w.DragEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  dataTransfer: dt,
                })
              );
            // Full HTML5 drag sequence so listeners bound to any stage fire.
            fire(src, "dragstart");
            fire(dst, "dragenter");
            fire(dst, "dragover");
            fire(dst, "drop");
            fire(src, "dragend");
          },
          { src: startHandle, dst: endHandle }
        );
      } finally {
        await startHandle.dispose();
        await endHandle.dispose();
      }
      return { mode: "native" };
    }

    await start.dragTo(end, { timeout });
    return { mode: "mouse" };
  } catch (err) {
    throw toAIFriendlyError(err, `${startRef} -> ${endRef}`);
  }
}

export async function dragAtViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  steps?: number;
}): Promise<void> {
  if (![opts.startX, opts.startY, opts.endX, opts.endY].every(Number.isFinite)) {
    throw new Error("startX, startY, endX, endY must be finite numbers");
  }
  const page = await getPageForTargetId({
    cdpUrl: opts.cdpUrl,
    targetId: opts.targetId,
  });
  ensurePageState(page);
  // Interpolate the move so `dragover`/pointer libraries that need more than one
  // mouse-move fire correctly (Playwright's docs: at least two moves are needed
  // to trigger dragover in all browsers). This is the coordinate-based sibling of
  // dragViaPlaywright for elements with no snapshot ref (canvas UIs, custom
  // widgets, overlays). It drives real mouse events, so — like browser_drag's
  // mouse mode — it does NOT carry a DataTransfer and won't trigger native HTML5
  // drag-and-drop; use browser_drag (native mode) for those.
  const steps = Math.max(2, Math.min(100, Math.floor(opts.steps ?? 10)));
  await page.mouse.move(opts.startX, opts.startY);
  await page.mouse.down();
  await page.mouse.move(opts.endX, opts.endY, { steps });
  await page.mouse.move(opts.endX, opts.endY);
  await page.mouse.up();
}

export async function selectOptionViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref: string;
  values: string[];
  timeoutMs?: number;
}): Promise<void> {
  const ref = requireRef(opts.ref);
  if (!opts.values?.length) {
    throw new Error("values are required");
  }
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  try {
    await refLocator(page, ref).selectOption(opts.values, {
      timeout: Math.max(500, Math.min(60_000, opts.timeoutMs ?? 8000)),
    });
  } catch (err) {
    throw toAIFriendlyError(err, ref);
  }
}

export async function pressKeyViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  key: string;
  delayMs?: number;
}): Promise<void> {
  const key = String(opts.key ?? "").trim();
  if (!key) {
    throw new Error("key is required");
  }
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  await page.keyboard.press(key, {
    delay: Math.max(0, Math.floor(opts.delayMs ?? 0)),
  });
}

export async function typeViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref: string;
  text: string;
  submit?: boolean;
  slowly?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const text = String(opts.text ?? "");
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const ref = requireRef(opts.ref);
  const locator = refLocator(page, ref);
  const timeout = Math.max(500, Math.min(60_000, opts.timeoutMs ?? 8000));
  try {
    if (opts.slowly) {
      await locator.click({ timeout });
      await locator.type(text, { timeout, delay: 75 });
    } else {
      await locator.fill(text, { timeout });
    }
    if (opts.submit) {
      await locator.press("Enter", { timeout });
    }
  } catch (err) {
    throw toAIFriendlyError(err, ref);
  }
}

export async function fillFormViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  fields: BrowserFormField[];
  timeoutMs?: number;
}): Promise<void> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const timeout = Math.max(500, Math.min(60_000, opts.timeoutMs ?? 8000));
  for (const field of opts.fields) {
    const ref = field.ref.trim();
    const type = field.type.trim();
    const rawValue = field.value;
    const value =
      typeof rawValue === "string"
        ? rawValue
        : typeof rawValue === "number" || typeof rawValue === "boolean"
          ? String(rawValue)
          : "";
    if (!ref || !type) {
      continue;
    }
    const locator = refLocator(page, ref);
    if (type === "checkbox" || type === "radio") {
      const checked =
        rawValue === true || rawValue === 1 || rawValue === "1" || rawValue === "true";
      try {
        await locator.setChecked(checked, { timeout });
      } catch (err) {
        throw toAIFriendlyError(err, ref);
      }
      continue;
    }
    try {
      await locator.fill(value, { timeout });
    } catch (err) {
      throw toAIFriendlyError(err, ref);
    }
  }
}

export async function evaluateViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  fn: string;
  ref?: string;
}): Promise<unknown> {
  const fnText = String(opts.fn ?? "").trim();
  if (!fnText) {
    throw new Error("function is required");
  }
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  if (opts.ref) {
    const locator = refLocator(page, opts.ref);
    // Use Function constructor at runtime to avoid esbuild adding __name helper
    // which doesn't exist in the browser context
     
    const elementEvaluator = new Function(
      "el",
      "fnBody",
      `
      "use strict";
      try {
        var candidate = eval("(" + fnBody + ")");
        return typeof candidate === "function" ? candidate(el) : candidate;
      } catch (err) {
        throw new Error("Invalid evaluate function: " + (err && err.message ? err.message : String(err)));
      }
      `,
    ) as (el: Element, fnBody: string) => unknown;
    return await locator.evaluate(elementEvaluator, fnText);
  }
  // Use Function constructor at runtime to avoid esbuild adding __name helper
  // which doesn't exist in the browser context
   
  const browserEvaluator = new Function(
    "fnBody",
    `
    "use strict";
    try {
      var candidate = eval("(" + fnBody + ")");
      return typeof candidate === "function" ? candidate() : candidate;
    } catch (err) {
      throw new Error("Invalid evaluate function: " + (err && err.message ? err.message : String(err)));
    }
    `,
  ) as (fnBody: string) => unknown;
  return await page.evaluate(browserEvaluator, fnText);
}

export async function scrollIntoViewViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref: string;
  timeoutMs?: number;
}): Promise<void> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 20_000);

  const ref = requireRef(opts.ref);
  const locator = refLocator(page, ref);
  try {
    await locator.scrollIntoViewIfNeeded({ timeout });
  } catch (err) {
    throw toAIFriendlyError(err, ref);
  }
}

export async function waitForViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  timeMs?: number;
  text?: string;
  textGone?: string;
  selector?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  fn?: string;
  timeoutMs?: number;
}): Promise<void> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 20_000);

  if (typeof opts.timeMs === "number" && Number.isFinite(opts.timeMs)) {
    await page.waitForTimeout(Math.max(0, opts.timeMs));
  }
  if (opts.text) {
    await page.getByText(opts.text).first().waitFor({
      state: "visible",
      timeout,
    });
  }
  if (opts.textGone) {
    await page.getByText(opts.textGone).first().waitFor({
      state: "hidden",
      timeout,
    });
  }
  if (opts.selector) {
    const selector = String(opts.selector).trim();
    if (selector) {
      await page.locator(selector).first().waitFor({ state: "visible", timeout });
    }
  }
  if (opts.url) {
    const url = String(opts.url).trim();
    if (url) {
      await page.waitForURL(url, { timeout });
    }
  }
  if (opts.loadState) {
    await page.waitForLoadState(opts.loadState, { timeout });
  }
  if (opts.fn) {
    const fn = String(opts.fn).trim();
    if (fn) {
      await page.waitForFunction(fn, { timeout });
    }
  }
}

export async function takeScreenshotViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref?: string;
  element?: string;
  fullPage?: boolean;
  type?: "png" | "jpeg";
  quality?: number;
  maxWidth?: number;
}): Promise<{ buffer: Buffer }> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const type = opts.type ?? "png";

  // Build screenshot options — quality only applies to jpeg
  const screenshotOpts: { type: "png" | "jpeg"; fullPage?: boolean; quality?: number } = { type };
  if (type === "jpeg" && typeof opts.quality === "number") {
    screenshotOpts.quality = Math.max(1, Math.min(100, Math.floor(opts.quality)));
  }

  let buffer: Buffer;

  if (opts.ref) {
    if (opts.fullPage) {
      throw new Error("fullPage is not supported for element screenshots");
    }
    const locator = refLocator(page, opts.ref);
    buffer = await locator.screenshot(screenshotOpts);
  } else if (opts.element) {
    if (opts.fullPage) {
      throw new Error("fullPage is not supported for element screenshots");
    }
    const locator = page.locator(opts.element).first();
    buffer = await locator.screenshot(screenshotOpts);
  } else {
    screenshotOpts.fullPage = Boolean(opts.fullPage);
    buffer = await page.screenshot(screenshotOpts);
  }

  // Resize if maxWidth specified and image is wider
  if (typeof opts.maxWidth === "number" && opts.maxWidth > 0) {
    buffer = await resizeScreenshot(buffer, opts.maxWidth, type);
  }

  return { buffer };
}

/**
 * Resize a screenshot buffer if it exceeds maxWidth.
 * Uses canvas-free approach via Playwright's page.evaluate for portability.
 * Falls back to returning original buffer if resize fails.
 */
async function resizeScreenshot(
  buffer: Buffer,
  maxWidth: number,
  type: "png" | "jpeg",
): Promise<Buffer> {
  // Parse PNG/JPEG dimensions from the header to check if resize is needed
  const width = getImageWidth(buffer, type);
  if (width !== null && width <= maxWidth) {
    return buffer; // Already within limits
  }

  // Use sharp if available (optional dependency), otherwise return original
  try {
    // Dynamic import to keep sharp optional — use string variable to prevent
    // TypeScript from resolving the module at compile time
    const moduleName = "sharp";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharp = await (import(moduleName) as Promise<any>).then((m) => m.default ?? m);
    const resized: Buffer = await sharp(buffer)
      .resize({ width: Math.floor(maxWidth), withoutEnlargement: true })
      .toFormat(type === "jpeg" ? "jpeg" : "png")
      .toBuffer();
    return resized;
  } catch {
    // sharp not installed — return original buffer with no resize
    return buffer;
  }
}

/** Read image width from PNG/JPEG header bytes. Returns null if unrecognized. */
function getImageWidth(buffer: Buffer, type: "png" | "jpeg"): number | null {
  if (type === "png" && buffer.length >= 24) {
    // PNG: width at bytes 16-19 (big-endian)
    return buffer.readUInt32BE(16);
  }
  if (type === "jpeg" && buffer.length > 2) {
    // JPEG: scan for SOF0/SOF2 markers
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        // SOF marker: height at offset+5, width at offset+7
        return buffer.readUInt16BE(offset + 7);
      }
      const segLen = buffer.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }
  return null;
}

export async function screenshotWithLabelsViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  refs: Record<string, { role: string; name?: string; nth?: number }>;
  maxLabels?: number;
  type?: "png" | "jpeg";
}): Promise<{ buffer: Buffer; labels: number; skipped: number }> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const type = opts.type ?? "png";
  const maxLabels =
    typeof opts.maxLabels === "number" && Number.isFinite(opts.maxLabels)
      ? Math.max(1, Math.floor(opts.maxLabels))
      : 150;

  const viewport = await page.evaluate(() => ({
    scrollX: window.scrollX || 0,
    scrollY: window.scrollY || 0,
    width: window.innerWidth || 0,
    height: window.innerHeight || 0,
  }));

  const refs = Object.keys(opts.refs ?? {});
  const boxes: Array<{ ref: string; x: number; y: number; w: number; h: number }> = [];
  let skipped = 0;

  for (const ref of refs) {
    if (boxes.length >= maxLabels) {
      skipped += 1;
      continue;
    }
    try {
      const box = await refLocator(page, ref).boundingBox();
      if (!box) {
        skipped += 1;
        continue;
      }
      const x0 = box.x;
      const y0 = box.y;
      const x1 = box.x + box.width;
      const y1 = box.y + box.height;
      const vx0 = viewport.scrollX;
      const vy0 = viewport.scrollY;
      const vx1 = viewport.scrollX + viewport.width;
      const vy1 = viewport.scrollY + viewport.height;
      if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) {
        skipped += 1;
        continue;
      }
      boxes.push({
        ref,
        x: x0 - viewport.scrollX,
        y: y0 - viewport.scrollY,
        w: Math.max(1, box.width),
        h: Math.max(1, box.height),
      });
    } catch {
      skipped += 1;
    }
  }

  try {
    if (boxes.length > 0) {
      await page.evaluate((labels) => {
        const existing = document.querySelectorAll("[data-openclaw-labels]");
        existing.forEach((el: Element) => el.remove());

        const root = document.createElement("div");
        root.setAttribute("data-openclaw-labels", "1");
        root.style.position = "fixed";
        root.style.left = "0";
        root.style.top = "0";
        root.style.zIndex = "2147483647";
        root.style.pointerEvents = "none";
        root.style.fontFamily =
          '"SF Mono","SFMono-Regular",Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace';

        const clamp = (value: number, min: number, max: number) =>
          Math.min(max, Math.max(min, value));

        for (const label of labels) {
          const box = document.createElement("div");
          box.setAttribute("data-openclaw-labels", "1");
          box.style.position = "absolute";
          box.style.left = `${label.x}px`;
          box.style.top = `${label.y}px`;
          box.style.width = `${label.w}px`;
          box.style.height = `${label.h}px`;
          box.style.border = "2px solid #ffb020";
          box.style.boxSizing = "border-box";

          const tag = document.createElement("div");
          tag.setAttribute("data-openclaw-labels", "1");
          tag.textContent = label.ref;
          tag.style.position = "absolute";
          tag.style.left = `${label.x}px`;
          tag.style.top = `${clamp(label.y - 18, 0, 20000)}px`;
          tag.style.background = "#ffb020";
          tag.style.color = "#1a1a1a";
          tag.style.fontSize = "12px";
          tag.style.lineHeight = "14px";
          tag.style.padding = "1px 4px";
          tag.style.borderRadius = "3px";
          tag.style.boxShadow = "0 1px 2px rgba(0,0,0,0.35)";
          tag.style.whiteSpace = "nowrap";

          root.appendChild(box);
          root.appendChild(tag);
        }

        document.documentElement.appendChild(root);
      }, boxes);
    }

    const buffer = await page.screenshot({ type });
    return { buffer, labels: boxes.length, skipped };
  } finally {
    await page
      .evaluate(() => {
        const existing = document.querySelectorAll("[data-openclaw-labels]");
        existing.forEach((el: Element) => el.remove());
      })
      .catch(() => {});
  }
}

export async function setInputFilesViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  inputRef?: string;
  element?: string;
  paths: string[];
}): Promise<void> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  if (!opts.paths.length) {
    throw new Error("paths are required");
  }
  const inputRef = typeof opts.inputRef === "string" ? opts.inputRef.trim() : "";
  const element = typeof opts.element === "string" ? opts.element.trim() : "";
  if (inputRef && element) {
    throw new Error("inputRef and element are mutually exclusive");
  }
  if (!inputRef && !element) {
    throw new Error("inputRef or element is required");
  }

  const locator = inputRef ? refLocator(page, inputRef) : page.locator(element).first();

  try {
    await locator.setInputFiles(opts.paths);
  } catch (err) {
    throw toAIFriendlyError(err, inputRef || element);
  }
  try {
    const handle = await locator.elementHandle();
    if (handle) {
      await handle.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  } catch {
    // Best-effort for sites that don't react to setInputFiles alone.
  }
}
