/**
 * Unit tests for dragViaPlaywright's input validation.
 * End-to-end behavior (mouse dragTo + native HTML5 DataTransfer dispatch) is
 * only verifiable against a running CDP endpoint and is covered via manual
 * smoke-testing in the PR.
 */

import { describe, it, expect } from "vitest";
import { dragViaPlaywright } from "../src/browser/pw-tools-interactions.js";

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
