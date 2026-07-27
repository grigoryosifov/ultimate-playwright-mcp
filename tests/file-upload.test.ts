/**
 * Unit tests for uploadFilesViaPlaywright's argument handling.
 *
 * These all fail before any browser connection is attempted, which is the
 * point: a bad path or a missing ref should be reported as such rather than
 * surfacing later as an opaque Playwright timeout that looks like the page's
 * fault. End-to-end behaviour (direct setInputFiles vs file-chooser
 * interception) is verified against a live CDP endpoint separately.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadFilesViaPlaywright } from "../src/browser/pw-tools-interactions.js";

const CDP = "http://127.0.0.1:9222";
let tmpDir: string;
let realFile: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "upm-upload-test-"));
  realFile = path.join(tmpDir, "real.txt");
  fs.writeFileSync(realFile, "hello", "utf-8");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("uploadFilesViaPlaywright — argument validation", () => {
  it("rejects an empty paths array", async () => {
    await expect(
      uploadFilesViaPlaywright({ cdpUrl: CDP, ref: "e1", paths: [] })
    ).rejects.toThrow(/paths are required/);
  });

  it("rejects paths that are only whitespace", async () => {
    await expect(
      uploadFilesViaPlaywright({ cdpUrl: CDP, ref: "e1", paths: ["  ", ""] })
    ).rejects.toThrow(/paths are required/);
  });

  it("names the missing file rather than failing obscurely", async () => {
    const ghost = path.join(tmpDir, "does-not-exist.png");
    await expect(
      uploadFilesViaPlaywright({ cdpUrl: CDP, ref: "e1", paths: [ghost] })
    ).rejects.toThrow(/file\(s\) not found: .*does-not-exist\.png/);
  });

  it("reports every missing file, not just the first", async () => {
    const a = path.join(tmpDir, "missing-a.png");
    const b = path.join(tmpDir, "missing-b.png");
    await expect(
      uploadFilesViaPlaywright({ cdpUrl: CDP, ref: "e1", paths: [a, realFile, b] })
    ).rejects.toThrow(/missing-a\.png.*missing-b\.png/);
  });

  it("rejects ref and element together", async () => {
    await expect(
      uploadFilesViaPlaywright({
        cdpUrl: CDP,
        ref: "e1",
        element: "input[type=file]",
        paths: [realFile],
      })
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("requires one of ref or element", async () => {
    await expect(
      uploadFilesViaPlaywright({ cdpUrl: CDP, paths: [realFile] })
    ).rejects.toThrow(/ref or element is required/);
  });

  it("validates arguments before attempting a browser connection", async () => {
    // CDP points at a port nothing is listening on. If validation ran after
    // connecting, these would surface as connection errors instead.
    await expect(
      uploadFilesViaPlaywright({ cdpUrl: "http://127.0.0.1:1", ref: "e1", paths: [] })
    ).rejects.toThrow(/paths are required/);
  });
});
