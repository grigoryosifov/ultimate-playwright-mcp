/**
 * MCP server implementation with Playwright browser control via CDP
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from "../config.js";
import type { ToolInputSchema, ToolHandler, RegisterToolFn } from "./types.js";
import { DaemonManager } from "../daemon/manager.js";
import { registerBrowserTabsTool } from "./tools/tabs.js";
import { registerBrowserNavigateTool } from "./tools/navigate.js";
import { registerBrowserSnapshotTool } from "./tools/snapshot.js";
import { registerBrowserActionTools } from "./tools/actions.js";
import { registerBrowserTabGroupTool } from "./tools/tab-group.js";
import { registerBrowserScreenshotTool } from "./tools/screenshot.js";
import { registerBrowserCheckpointTools } from "./tools/checkpoint.js";
import { warmupTabGrouper, seedExtensionIdFromPath } from "../browser/chrome-tab-groups.js";
import { setStealthInjectionEnabled } from "../browser/stealth.js";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type ServerRuntimeOptions = {
  lazyDaemonStart?: boolean;
};

export async function createMCPServer(
  config: ServerConfig,
  runtime: ServerRuntimeOptions = {},
) {
  const server = new Server(
    {
      name: "ultimate-playwright-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Tool registry
  const tools = new Map<string, {
    description: string;
    inputSchema: ToolInputSchema;
    handler: ToolHandler;
  }>();

  // Helper to register tools
  const registerTool: RegisterToolFn = (name, description, inputSchema, handler) => {
    tools.set(name, { description, inputSchema, handler });
  };

  // Register all tools
  registerBrowserTabGroupTool(registerTool, config);
  registerBrowserTabsTool(registerTool, config);
  registerBrowserNavigateTool(registerTool, config);
  registerBrowserSnapshotTool(registerTool, config);
  registerBrowserActionTools(registerTool, config);
  registerBrowserScreenshotTool(registerTool, config);
  registerBrowserCheckpointTools(registerTool, config);

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Array.from(tools.entries()).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.get(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      if (runtime.lazyDaemonStart) {
        await DaemonManager.ensureDaemonRunning({
          chromeUserDataDir: config.chromeUserDataDir,
          chromeExtensions: config.chromeExtensions,
          chromeExecutable: config.chromeExecutable,
          downloadDir: config.downloadDir,
          keepAlive: config.keepAlive,
        });
      }

      const result = await tool.handler(args || {});

      // Handle image responses (e.g., screenshots)
      if (result && typeof result === "object" && "__image" in result) {
        const img = result as unknown as { base64: string; mimeType: string };
        return {
          content: [
            {
              type: "image" as const,
              data: img.base64,
              mimeType: img.mimeType,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function runServer(config: ServerConfig) {
  // If no explicit CDP endpoint was provided, use the managed daemon endpoint.
  // Daemon startup is lazy and happens on first tool call.
  const managedDaemonMode = !config.cdpEndpoint;
  if (managedDaemonMode) {
    config.cdpEndpoint = DaemonManager.getCdpEndpoint();
  }

  // Stealth shims only make sense for a browser we launch ourselves. When the
  // user points us at their own Chrome it already reports honest values, and
  // patching would fabricate detectable tells rather than remove them.
  setStealthInjectionEnabled(managedDaemonMode);

  const server = await createMCPServer(config, {
    lazyDaemonStart: managedDaemonMode,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Seed the companion extension ID so we can wake it when its SW goes dormant.
  // Look for the bundled extension relative to this file, or in the configured extensions.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const bundledExtPath = join(__dirname, "..", "..", "extensions", "tab-grouper");
  if (existsSync(bundledExtPath)) {
    seedExtensionIdFromPath(bundledExtPath);
  }
  // Also check if it's in the configured extensions list
  if (config.chromeExtensions) {
    for (const ext of config.chromeExtensions) {
      if (ext.includes("tab-grouper") && existsSync(ext)) {
        seedExtensionIdFromPath(ext);
        break;
      }
    }
  }

  // Warm up: discover companion extension while its SW is still alive
  if (config.cdpEndpoint) {
    warmupTabGrouper(config.cdpEndpoint).catch(() => {});
  }

  // Log to stderr so it doesn't interfere with stdio transport
  console.error("Ultimate Playwright MCP server running on stdio");
  if (config.agentId) {
    console.error(`Agent ID: ${config.agentId}`);
  }
  console.error(`CDP Endpoint: ${config.cdpEndpoint}`);
}
