/**
 * Unit tests for clickAtViaPlaywright's input validation.
 * End-to-end behavior (actual mouse clicks) is only verifiable against a
 * running CDP endpoint and is covered via manual smoke-testing in the PR.
 */

import { describe, it, expect } from "vitest";
import { clickAtViaPlaywright } from "../src/browser/pw-tools-interactions.js";

describe("clickAtViaPlaywright — input validation", () => {
  it("rejects non-finite x", async () => {
    await expect(
      clickAtViaPlaywright({
        cdpUrl: "http://localhost:9222",
        x: NaN,
        y: 100,
      })
    ).rejects.toThrow(/finite numbers/);
  });

  it("rejects non-finite y", async () => {
    await expect(
      clickAtViaPlaywright({
        cdpUrl: "http://localhost:9222",
        x: 100,
        y: Infinity,
      })
    ).rejects.toThrow(/finite numbers/);
  });

  it("rejects missing coordinates", async () => {
    await expect(
      clickAtViaPlaywright({
        cdpUrl: "http://localhost:9222",
        x: undefined as unknown as number,
        y: 100,
      })
    ).rejects.toThrow(/finite numbers/);
  });
});
