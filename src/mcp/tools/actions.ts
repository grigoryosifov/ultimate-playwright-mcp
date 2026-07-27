/**
 * Browser action tools - click, type, hover, etc.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  clickViaPlaywright,
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
        humanize: {
          type: "boolean",
          description:
            "Approach along a curved cursor path and press with a realistic hold instead of teleporting to the element's exact centre (default true). Set false for bulk clicking where the ~0.3-0.6s per click is not worth it.",
        },
      },
      required: ["ref"],
    },
    async (args: {
      ref: string;
      targetId?: string;
      button?: "left" | "right" | "middle";
      doubleClick?: boolean;
      humanize?: boolean;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await clickViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        button: args.button,
        doubleClick: args.doubleClick,
        humanize: args.humanize,
      });

      return `**Clicked** element ${args.ref}`;
    }
  );

  // browser_type
  register(
    "browser_type",
    "Type text into an element. Types with human cadence by default (per-key hold, jittered gaps, occasional pauses and typo-corrections), which is what you want for anything a person is supposed to have written — a comment, a DM, a message. Pass humanize:false for bulk or dashboard entry where speed matters.",
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
        humanize: {
          type: "boolean",
          description:
            "Type key by key with human timing (default true). false writes the value in one shot via fill(), which fires no keyboard events at all — fast, but the most machine-looking input available. Roughly 70ms per character when enabled.",
        },
        slowly: {
          type: "boolean",
          description:
            "Type more deliberately (slower cadence, longer pauses). Useful for editors that drop fast input.",
        },
      },
      required: ["ref", "text"],
    },
    async (args: {
      ref: string;
      text: string;
      targetId?: string;
      submit?: boolean;
      humanize?: boolean;
      slowly?: boolean;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await typeViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        text: args.text,
        submit: args.submit,
        humanize: args.humanize,
        slowly: args.slowly,
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
