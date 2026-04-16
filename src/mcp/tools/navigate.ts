/**
 * browser_navigate tool - navigate to URLs in specific tabs
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import { navigateViaPlaywright } from "../../browser/pw-tools-snapshot.js";
import { preserveFrontmostApp } from "../../utils/macos-focus.js";

export function registerBrowserNavigateTool(
  register: RegisterToolFn,
  config: ServerConfig
) {
  register(
    "browser_navigate",
    "Navigate to a URL in a specific tab. Use targetId from browser_tabs to specify which tab.",
    {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to navigate to",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab (from browser_tabs). If not provided, uses first available tab.",
        },
      },
      required: ["url"],
    },
    async (args: { url: string; targetId?: string }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const result = await preserveFrontmostApp(() =>
        navigateViaPlaywright({
          cdpUrl: config.cdpEndpoint!,
          targetId: args.targetId,
          url: args.url,
        }),
      );

      return `**Navigation successful**\\nURL: ${result.url}`;
    }
  );
}
