/**
 * The stealth script must only be injected into a browser this server launched
 * itself. Injecting it into a user's own Chrome (attached via --cdp-endpoint)
 * replaces honest values with values no real Chrome reports, which is a worse
 * signal than injecting nothing at all.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { BrowserContext } from "playwright-core";
import {
  STEALTH_SCRIPT,
  setStealthInjectionEnabled,
  isStealthInjectionEnabled,
} from "../src/browser/stealth.js";
import { observeContext } from "../src/browser/pw-session.js";

/**
 * Minimal BrowserContext stand-in that records addInitScript calls.
 * A fresh object per test matters: observeContext dedupes by identity.
 */
function makeFakeContext() {
  const injected: string[] = [];
  const context = {
    addInitScript: async (script: string) => {
      injected.push(script);
    },
    pages: () => [],
    on: () => {},
  } as unknown as BrowserContext;
  return { context, injected };
}

describe("stealth injection flag", () => {
  afterEach(() => {
    setStealthInjectionEnabled(false);
  });

  it("defaults to disabled so an un-wired caller never patches a real browser", () => {
    expect(isStealthInjectionEnabled()).toBe(false);
  });

  it("round-trips through the setter", () => {
    setStealthInjectionEnabled(true);
    expect(isStealthInjectionEnabled()).toBe(true);
    setStealthInjectionEnabled(false);
    expect(isStealthInjectionEnabled()).toBe(false);
  });
});

describe("observeContext — injection gating", () => {
  afterEach(() => {
    setStealthInjectionEnabled(false);
  });

  it("does NOT inject when disabled (external CDP endpoint / user's own Chrome)", () => {
    setStealthInjectionEnabled(false);
    const { context, injected } = makeFakeContext();
    observeContext(context);
    expect(injected).toEqual([]);
  });

  it("injects when enabled (managed-daemon mode, browser we launched)", () => {
    setStealthInjectionEnabled(true);
    const { context, injected } = makeFakeContext();
    observeContext(context);
    expect(injected).toHaveLength(1);
    expect(injected[0]).toBe(STEALTH_SCRIPT);
  });
});

describe("STEALTH_SCRIPT — the tells that justify the gate", () => {
  // These assertions document *why* the gate exists. If the script is ever
  // rewritten so these patches are gone, the gate can be revisited — but until
  // then, each of these is observable from any page and absent in real Chrome.

  it("forces navigator.webdriver to undefined (real Chrome reports false)", () => {
    expect(STEALTH_SCRIPT).toContain("'webdriver'");
    expect(STEALTH_SCRIPT).toContain("get: () => undefined");
  });

  it("fabricates a chrome.runtime object", () => {
    expect(STEALTH_SCRIPT).toContain("window.chrome.runtime = {");
  });

  it("replaces Function.prototype.toString, whose source a page can read back", () => {
    expect(STEALTH_SCRIPT).toContain("Function.prototype.toString = function");
  });

  it("replaces Object.getOwnPropertyDescriptor", () => {
    expect(STEALTH_SCRIPT).toContain("Object.getOwnPropertyDescriptor = function");
  });
});
