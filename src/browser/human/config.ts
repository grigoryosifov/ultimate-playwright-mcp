/**
 * Human-behaviour tuning parameters.
 *
 * Vendored from CloakBrowser's MIT-licensed wrapper (js/src/human/config.ts),
 * https://github.com/CloakHQ/CloakBrowser — Copyright (c) 2026 CloakHQ, MIT.
 * Trimmed to the mouse/keyboard parameters this server uses; scroll pacing is
 * left to callers.
 *
 * Why these exist: Playwright's default input is a metronome. locator.click()
 * teleports the cursor to the exact centre of an element and presses with a 0ms
 * hold; locator.type(text, { delay: 75 }) emits a keystroke every 75.000ms.
 * Neither pattern occurs in human input, and both are trivially measurable by
 * behavioural analytics on a logged-in session.
 */

export interface HumanConfig {
  // Keyboard
  typing_delay: number;
  typing_delay_spread: number;
  typing_pause_chance: number;
  typing_pause_range: [number, number];
  key_hold: [number, number];
  mistype_chance: number;
  mistype_delay_notice: [number, number];
  mistype_delay_correct: [number, number];

  // Mouse — movement
  mouse_steps_divisor: number;
  mouse_min_steps: number;
  mouse_max_steps: number;
  mouse_wobble_max: number;
  mouse_overshoot_chance: number;
  mouse_overshoot_px: [number, number];
  mouse_burst_size: [number, number];
  mouse_burst_pause: [number, number];

  // Mouse — clicks
  click_aim_delay_input: [number, number];
  click_aim_delay_button: [number, number];
  click_hold_input: [number, number];
  click_hold_button: [number, number];
  click_input_x_range: [number, number];

  // Initial cursor position (as if arriving from the address bar area)
  initial_cursor_x: [number, number];
  initial_cursor_y: [number, number];
}

export type HumanPreset = "default" | "careful";

const DEFAULT_CONFIG: HumanConfig = {
  typing_delay: 70,
  typing_delay_spread: 40,
  typing_pause_chance: 0.1,
  typing_pause_range: [400, 1000],
  key_hold: [15, 35],
  mistype_chance: 0.02,
  mistype_delay_notice: [100, 300],
  mistype_delay_correct: [50, 150],

  mouse_steps_divisor: 8,
  mouse_min_steps: 25,
  mouse_max_steps: 80,
  mouse_wobble_max: 1.5,
  mouse_overshoot_chance: 0.15,
  mouse_overshoot_px: [3, 6],
  mouse_burst_size: [3, 5],
  mouse_burst_pause: [8, 18],

  click_aim_delay_input: [60, 140],
  click_aim_delay_button: [80, 200],
  click_hold_input: [40, 100],
  click_hold_button: [60, 150],
  click_input_x_range: [0.05, 0.3],

  initial_cursor_x: [400, 700],
  initial_cursor_y: [45, 60],
};

const CAREFUL_CONFIG: HumanConfig = {
  ...DEFAULT_CONFIG,

  typing_delay: 100,
  typing_delay_spread: 50,
  typing_pause_chance: 0.15,
  typing_pause_range: [500, 1200],
  key_hold: [20, 45],
  mistype_chance: 0.03,
  mistype_delay_notice: [150, 400],
  mistype_delay_correct: [80, 200],

  mouse_overshoot_chance: 0.1,
  mouse_burst_pause: [12, 25],

  click_aim_delay_input: [80, 180],
  click_aim_delay_button: [120, 280],
  click_hold_input: [60, 140],
  click_hold_button: [80, 200],
};

const PRESETS: Record<HumanPreset, HumanConfig> = {
  default: DEFAULT_CONFIG,
  careful: CAREFUL_CONFIG,
};

/** Resolve a preset name plus optional overrides into a full config. */
export function resolveConfig(
  preset: HumanPreset = "default",
  overrides?: Partial<HumanConfig>,
): HumanConfig {
  const base = PRESETS[preset];
  if (!base) {
    throw new Error(
      `Unknown humanize preset "${preset}". Valid presets: ${Object.keys(PRESETS).join(", ")}`,
    );
  }
  return overrides ? { ...base, ...overrides } : { ...base };
}

/** Random float in [min, max]. */
export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random integer in [min, max] (inclusive). */
export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/** Random float from a [min, max] tuple. */
export function randRange(range: [number, number]): number {
  return rand(range[0], range[1]);
}

/** Random integer from a [min, max] tuple. */
export function randIntRange(range: [number, number]): number {
  return randInt(range[0], range[1]);
}

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
