/**
 * Browser action tools - click, type, hover, etc.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  clickViaPlaywright,
  clickAtViaPlaywright,
  typeViaPlaywright,
  hoverViaPlaywright,
  pressKeyViaPlaywright,
  fillFormViaPlaywright,
  waitForViaPlaywright,
  evaluateViaPlaywright,
  type BrowserFormField,
} from "../../browser/pw-tools-interactions.js";

export function registerBrowserActionTools(
  register: RegisterToolFn,
  config: ServerConfig
) {
  // browser_click
  register(
    "browser_click",
    "Click an element by its ref (e1, e2, etc. from snapshot)",
    {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element reference from snapshot (e.g., 'e1', 'e2')",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button to click (default: left)",
        },
        doubleClick: {
          type: "boolean",
          description: "Perform a double-click",
        },
      },
      required: ["ref"],
    },
    async (args: { ref: string; targetId?: string; button?: "left" | "right" | "middle"; doubleClick?: boolean }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await clickViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        button: args.button,
        doubleClick: args.doubleClick,
      });

      return `**Clicked** element ${args.ref}`;
    }
  );

  // browser_click_at
  register(
    "browser_click_at",
    "Click at absolute page coordinates (x, y). Use as last resort when browser_click (ref-based) and browser_evaluate (JS `element.click()`) both fail — e.g., canvas-rendered UI, invisible overlays, pointer-events traps. Get coordinates from browser_screenshot. Does NOT work inside cross-origin iframes — use browser_press_key keyboard navigation there.",
    {
      type: "object",
      properties: {
        x: {
          type: "number",
          description: "Absolute X coordinate in viewport pixels (from browser_screenshot)",
        },
        y: {
          type: "number",
          description: "Absolute Y coordinate in viewport pixels",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button to click (default: left)",
        },
        doubleClick: {
          type: "boolean",
          description: "Perform a double-click",
        },
      },
      required: ["x", "y"],
    },
    async (args: {
      x: number;
      y: number;
      targetId?: string;
      button?: "left" | "right" | "middle";
      doubleClick?: boolean;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await clickAtViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        x: args.x,
        y: args.y,
        button: args.button,
        doubleClick: args.doubleClick,
      });

      return `**Clicked** at (${args.x}, ${args.y})`;
    }
  );

  // browser_type
  register(
    "browser_type",
    "Type text into an element",
    {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element reference from snapshot",
        },
        text: {
          type: "string",
          description: "Text to type",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        submit: {
          type: "boolean",
          description: "Press Enter after typing",
        },
      },
      required: ["ref", "text"],
    },
    async (args: { ref: string; text: string; targetId?: string; submit?: boolean }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await typeViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        text: args.text,
        submit: args.submit,
      });

      return `**Typed** "${args.text}" into ${args.ref}`;
    }
  );

  // browser_hover
  register(
    "browser_hover",
    "Hover over an element",
    {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element reference from snapshot",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
      required: ["ref"],
    },
    async (args: { ref: string; targetId?: string }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await hoverViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
      });

      return `**Hovered** over ${args.ref}`;
    }
  );

  // browser_press_key
  register(
    "browser_press_key",
    "Press a keyboard key",
    {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key to press (e.g., 'Enter', 'Escape', 'ArrowDown')",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
      required: ["key"],
    },
    async (args: { key: string; targetId?: string }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await pressKeyViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        key: args.key,
      });

      return `**Pressed** key: ${args.key}`;
    }
  );

  // browser_fill_form
  register(
    "browser_fill_form",
    "Fill multiple form fields at once",
    {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description: "Array of form fields to fill",
          items: {
            type: "object",
            properties: {
              ref: { type: "string" },
              type: { type: "string" },
              value: { type: ["string", "number", "boolean"] },
            },
            required: ["ref", "type"],
          },
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
      required: ["fields"],
    },
    async (args: { fields: BrowserFormField[]; targetId?: string }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await fillFormViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        fields: args.fields,
      });

      return `**Filled** ${args.fields.length} form field(s)`;
    }
  );

  // browser_wait_for
  register(
    "browser_wait_for",
    "Wait for a condition (text, selector, load state, time, etc.)",
    {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Wait for text to appear on page",
        },
        textGone: {
          type: "string",
          description: "Wait for text to disappear from page",
        },
        selector: {
          type: "string",
          description: "Wait for CSS selector",
        },
        url: {
          type: "string",
          description: "Wait for URL to match pattern",
        },
        loadState: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle"],
          description: "Wait for load state",
        },
        timeMs: {
          type: "number",
          description: "Wait for specific milliseconds",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
    },
    async (args: {
      text?: string;
      textGone?: string;
      selector?: string;
      url?: string;
      loadState?: "load" | "domcontentloaded" | "networkidle";
      timeMs?: number;
      targetId?: string;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await waitForViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        text: args.text,
        textGone: args.textGone,
        selector: args.selector,
        url: args.url,
        loadState: args.loadState,
        timeMs: args.timeMs,
      });

      const conditions = [
        args.text && `text: "${args.text}"`,
        args.textGone && `text gone: "${args.textGone}"`,
        args.selector && `selector: ${args.selector}`,
        args.url && `URL: ${args.url}`,
        args.loadState && `load state: ${args.loadState}`,
        args.timeMs && `${args.timeMs}ms`,
      ].filter(Boolean);

      return `**Wait completed** for ${conditions.join(", ")}`;
    }
  );

  // browser_evaluate
  register(
    "browser_evaluate",
    "Execute JavaScript in the page context via Playwright's page.evaluate(). Use for interacting with elements not in the accessibility snapshot (portal divs, framework overlays, shadow DOM). Can run arbitrary JS — click hidden elements, extract data, manipulate the DOM. Optionally scope to a specific element via ref.",
    {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "JavaScript expression or function body to evaluate in the browser. " +
            "Can be a simple expression like `document.title` or a function like " +
            "`() => document.querySelector('.menu').click()`. " +
            "If ref is provided, receives the element as first argument: `(el) => el.textContent`.",
        },
        ref: {
          type: "string",
          description:
            "Optional element reference from snapshot (e.g., 'e1'). " +
            "If provided, the expression receives the DOM element as its first argument.",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
      },
      required: ["expression"],
    },
    async (args: { expression: string; ref?: string; targetId?: string }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      const result = await evaluateViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        fn: args.expression,
        ref: args.ref,
      });

      // Format the result for display
      if (result === undefined) return "**Evaluated** — returned `undefined`";
      if (result === null) return "**Evaluated** — returned `null`";
      if (typeof result === "string") return `**Evaluated** — returned: "${result}"`;
      if (typeof result === "number" || typeof result === "boolean")
        return `**Evaluated** — returned: ${result}`;
      return `**Evaluated** — returned:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
    }
  );
}
