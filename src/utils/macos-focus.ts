/**
 * Capture the frontmost macOS app, run fn, then restore focus to it.
 * Prevents Chrome from stealing focus during tab creation / navigation.
 * No-op on non-macOS platforms.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export async function preserveFrontmostApp<T>(fn: () => Promise<T>): Promise<T> {
  if (process.platform !== "darwin") {
    return fn();
  }
  let frontApp: string | null = null;
  try {
    const { stdout } = await execFile(
      "osascript",
      [
        "-e",
        'tell application "System Events" to name of first application process whose frontmost is true',
      ],
      { timeout: 1000 },
    );
    frontApp = stdout.trim() || null;
  } catch {
    // best-effort
  }
  try {
    return await fn();
  } finally {
    if (frontApp && !/^Google Chrome$|^Chrome Agents$|^Chromium$/.test(frontApp)) {
      try {
        await execFile(
          "osascript",
          ["-e", `tell application ${JSON.stringify(frontApp)} to activate`],
          { timeout: 1000 },
        );
      } catch {
        // best-effort
      }
    }
  }
}
