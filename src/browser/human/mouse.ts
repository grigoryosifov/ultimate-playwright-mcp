/**
 * Human-like mouse movement.
 *
 * Vendored from CloakBrowser's MIT-licensed wrapper (js/src/human/mouse.ts),
 * https://github.com/CloakHQ/CloakBrowser — Copyright (c) 2026 CloakHQ, MIT.
 *
 * A real cursor travels along a curved path, decelerates near the target,
 * carries sub-pixel tremor, pauses in small bursts, and sometimes overshoots
 * and corrects. Playwright's default is an instant jump to the element centre.
 */

import { HumanConfig, rand, randRange, randIntRange, sleep } from "./config.js";

/** The subset of Playwright's Mouse we drive. */
export interface RawMouse {
  move: (x: number, y: number) => Promise<void>;
}

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cubic ease-in-out: slow start, fast middle, slow arrival. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Cubic Bezier interpolation at parameter `t`. */
export function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Two control points offset perpendicular to the straight line, so the path
 * bows to one side by a random amount instead of running dead straight.
 */
export function randomControlPoints(start: Point, end: Point): [Point, Point] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const px = -dy / (dist || 1);
  const py = dx / (dist || 1);
  const bias1 = rand(-0.3, 0.3) * dist;
  const bias2 = rand(-0.3, 0.3) * dist;
  return [
    { x: start.x + dx * 0.25 + px * bias1, y: start.y + dy * 0.25 + py * bias1 },
    { x: start.x + dx * 0.75 + px * bias2, y: start.y + dy * 0.75 + py * bias2 },
  ];
}

/**
 * Move the cursor from (startX, startY) to (endX, endY) along a curved,
 * eased path with tremor, burst pauses and an occasional overshoot.
 */
export async function humanMove(
  raw: RawMouse,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  cfg: HumanConfig,
): Promise<void> {
  const dist = Math.hypot(endX - startX, endY - startY);
  if (dist < 1) return;

  const steps = Math.max(
    cfg.mouse_min_steps,
    Math.min(cfg.mouse_max_steps, Math.round(dist / cfg.mouse_steps_divisor)),
  );

  const start: Point = { x: startX, y: startY };
  const end: Point = { x: endX, y: endY };
  const [cp1, cp2] = randomControlPoints(start, end);

  let burstCounter = 0;
  const burstSize = randIntRange(cfg.mouse_burst_size);

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const pt = bezier(start, cp1, cp2, end, easeInOut(progress));

    // Tremor peaks mid-flight and settles to zero at both ends.
    const wobbleAmp = Math.sin(Math.PI * progress) * cfg.mouse_wobble_max;
    const wx = pt.x + (Math.random() - 0.5) * 2 * wobbleAmp;
    const wy = pt.y + (Math.random() - 0.5) * 2 * wobbleAmp;

    await raw.move(Math.round(wx), Math.round(wy));

    burstCounter++;
    if (burstCounter >= burstSize && i < steps) {
      await sleep(randRange(cfg.mouse_burst_pause));
      burstCounter = 0;
    }
  }

  if (Math.random() < cfg.mouse_overshoot_chance) {
    const overshootDist = randRange(cfg.mouse_overshoot_px);
    const angle = Math.atan2(endY - startY, endX - startX);
    await raw.move(
      Math.round(endX + Math.cos(angle) * overshootDist),
      Math.round(endY + Math.sin(angle) * overshootDist),
    );
    await sleep(rand(30, 70));
    await raw.move(
      Math.round(endX + (Math.random() - 0.5) * 4),
      Math.round(endY + (Math.random() - 0.5) * 4),
    );
  }
}

/**
 * Pick where inside an element a human would actually aim.
 *
 * Text fields get clicked near the left edge, where the caret goes; buttons
 * get clicked near the middle but never at the exact centre pixel.
 */
export function clickTarget(box: BoundingBox, isInput: boolean, cfg: HumanConfig): Point {
  const xFrac = isInput ? randRange(cfg.click_input_x_range) : rand(0.35, 0.65);
  const yFrac = isInput ? rand(0.3, 0.7) : rand(0.35, 0.65);
  return {
    x: box.x + box.width * xFrac,
    y: box.y + box.height * yFrac,
  };
}
