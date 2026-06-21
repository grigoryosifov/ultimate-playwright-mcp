/**
 * Unit tests for dragViaPlaywright's input validation.
 * End-to-end behavior (mouse dragTo + native HTML5 DataTransfer dispatch) is
 * only verifiable against a running CDP endpoint and is covered via manual
 * smoke-testing in the PR.
 */

import { describe, it, expect } from "vitest";
import {
  dragViaPlaywright,
  dragAtViaPlaywright,
} from "../src/browser/pw-tools-interactions.js";

describe("dragViaPlaywright — input validation", () => {
  it("rejects empty startRef", async () => {
    await expect(
      dragViaPlaywright({
        cdpUrl: "http://localhost:9222",
        startRef: "",
        endRef: "e2",
      })
    ).rejects.toThrow(/ref is required/);
  });

  it("rejects empty endRef", async () => {
    await expect(
      dragViaPlaywright({
        cdpUrl: "http://localhost:9222",
        startRef: "e1",
        endRef: "",
      })
    ).rejects.toThrow(/ref is required/);
  });

  it("rejects missing startRef", async () => {
    await expect(
      dragViaPlaywright({
        cdpUrl: "http://localhost:9222",
        startRef: undefined as unknown as string,
        endRef: "e2",
      })
    ).rejects.toThrow(/ref is required/);
  });
});

describe("dragAtViaPlaywright — input validation", () => {
  it("rejects non-finite startX", async () => {
    await expect(
      dragAtViaPlaywright({
        cdpUrl: "http://localhost:9222",
        startX: NaN,
        startY: 10,
        endX: 100,
        endY: 100,
      })
    ).rejects.toThrow(/finite numbers/);
  });

  it("rejects non-finite endY", async () => {
    await expect(
      dragAtViaPlaywright({
        cdpUrl: "http://localhost:9222",
        startX: 10,
        startY: 10,
        endX: 100,
        endY: Infinity,
      })
    ).rejects.toThrow(/finite numbers/);
  });

  it("rejects missing coordinates", async () => {
    await expect(
      dragAtViaPlaywright({
        cdpUrl: "http://localhost:9222",
        startX: 10,
        startY: 10,
        endX: undefined as unknown as number,
        endY: 100,
      })
    ).rejects.toThrow(/finite numbers/);
  });
});
