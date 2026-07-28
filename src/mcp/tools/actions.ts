/**
 * Browser action tools - click, type, hover, etc.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  clickViaPlaywright,
  clickAtViaPlaywright,
  dragViaPlaywright,
  dragAtViaPlaywright,
  typeViaPlaywright,
  hoverViaPlaywright,
  pressKeyViaPlaywright,
  fillFormViaPlaywright,
  uploadFilesViaPlaywright,
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

  // browser_drag
  register(
    "browser_drag",
    "Drag one element onto another (drag-and-drop) by their snapshot refs. mode:'auto' (default) detects native HTML5 drag-and-drop (a draggable source) and dispatches the drag events with a real DataTransfer; otherwise it uses Playwright's mouse-based dragTo for pointer/JS libraries (MUI, dnd-kit, SortableJS). Force a tier with mode:'mouse' (pointer libs) or mode:'native' (HTML5 dataTransfer; Chromium/Firefox only). Get both refs from browser_snapshot.",
    {
      type: "object",
      properties: {
        startRef: {
          type: "string",
          description: "Ref of the element to drag (from snapshot, e.g. 'e5')",
        },
        endRef: {
          type: "string",
          description: "Ref of the drop-target element (from snapshot, e.g. 'e9')",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        mode: {
          type: "string",
          enum: ["auto", "mouse", "native"],
          description: "Drag strategy (default: auto — detects HTML5 vs pointer-based)",
        },
        timeoutMs: {
          type: "number",
          description: "Per-step timeout in ms (default 8000)",
        },
      },
      required: ["startRef", "endRef"],
    },
    async (args: {
      startRef: string;
      endRef: string;
      targetId?: string;
      mode?: "auto" | "mouse" | "native";
      timeoutMs?: number;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      const result = await dragViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        startRef: args.startRef,
        endRef: args.endRef,
        mode: args.mode,
        timeoutMs: args.timeoutMs,
      });

      return `**Dragged** ${args.startRef} → ${args.endRef} (${result.mode} mode)`;
    }
  );

  // browser_drag_at
  register(
    "browser_drag_at",
    "Drag from absolute page coordinates (startX, startY) to (endX, endY). Coordinate-based sibling of browser_drag — use when the source/target have no snapshot ref (canvas-rendered UI, custom widgets, overlays not in the accessibility tree). Get coordinates from browser_screenshot. Drives real mouse events (move → down → move → up), so it handles pointer/JS drag libraries but NOT native HTML5 drag-and-drop (no DataTransfer) — for those use browser_drag with mode:'native'. Blocked inside cross-origin iframes.",
    {
      type: "object",
      properties: {
        startX: {
          type: "number",
          description: "Absolute X of the drag start, in viewport pixels (from browser_screenshot)",
        },
        startY: {
          type: "number",
          description: "Absolute Y of the drag start, in viewport pixels",
        },
        endX: {
          type: "number",
          description: "Absolute X of the drop point, in viewport pixels",
        },
        endY: {
          type: "number",
          description: "Absolute Y of the drop point, in viewport pixels",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        steps: {
          type: "number",
          description: "Intermediate mouse-move steps between start and end (default 10; min 2 so dragover fires)",
        },
      },
      required: ["startX", "startY", "endX", "endY"],
    },
    async (args: {
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      targetId?: string;
      steps?: number;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await dragAtViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        startX: args.startX,
        startY: args.startY,
        endX: args.endX,
        endY: args.endY,
        steps: args.steps,
      });

      return `**Dragged** (${args.startX}, ${args.startY}) → (${args.endX}, ${args.endY})`;
    }
  );

  // browser_type
  register(
    "browser_type",
    "Type text into an element. Types with human cadence by default (per-key hold, jittered gaps, occasional pauses and typo-corrections), which is what you want for anything a person is supposed to have written — a comment, a DM, a message. Pass humanize:false for bulk or dashboard entry where speed matters. Pass append:true to keep the element's existing content (e.g. a prefilled @mention) and type at its end instead of replacing it.",
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
        append: {
          type: "boolean",
          description:
            "Type at the END of the existing content instead of replacing it (default false clears the field first: select-all + Delete). Use on composers that pre-fill content that must survive — e.g. LinkedIn reply boxes, where the prefilled @mention is a link the clear would destroy.",
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
      append?: boolean;
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
        append: args.append,
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
        humanize: {
          type: "boolean",
          description:
            "Approach along a curved cursor path and settle on the target instead of teleporting onto it (default true). The brief dwell also helps with menus that open on hover-and-hold rather than first contact.",
        },
      },
      required: ["ref"],
    },
    async (args: { ref: string; targetId?: string; humanize?: boolean }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      await hoverViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        humanize: args.humanize,
      });

      return `**Hovered** over ${args.ref}`;
    }
  );

  // browser_file_upload
  register(
    "browser_file_upload",
    "Upload local file(s) into a page. Handles both shapes automatically: if ref/element is an <input type=file> the files are set directly (works even when the input is hidden); otherwise the target is treated as the control that OPENS the picker — the file chooser is intercepted before it can open, the control is clicked, and the files are supplied to it. That second path is what gets past a native OS file dialog, which cannot be filled once it is already open. Use this instead of clicking an upload button and hoping.",
    {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Absolute path(s) to the local file(s) to upload. Must exist on this machine.",
        },
        ref: {
          type: "string",
          description:
            "Element reference from snapshot — either the file input itself, or the button/drop-zone that opens the file picker",
        },
        element: {
          type: "string",
          description:
            "CSS selector alternative to ref (useful when the file input is hidden and absent from the snapshot, e.g. 'input[type=file]')",
        },
        targetId: {
          type: "string",
          description: "Target ID of the tab",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in ms (default 15000)",
        },
        humanize: {
          type: "boolean",
          description:
            "Humanize the click that opens the picker (default true). Only applies when the target is a button/drop-zone; setting files on an input directly never clicks anything.",
        },
      },
      required: ["paths"],
    },
    async (args: {
      paths: string[];
      ref?: string;
      element?: string;
      targetId?: string;
      timeoutMs?: number;
      humanize?: boolean;
    }) => {
      if (!config.cdpEndpoint) throw new Error("CDP endpoint not configured");

      const result = await uploadFilesViaPlaywright({
        cdpUrl: config.cdpEndpoint,
        targetId: args.targetId,
        ref: args.ref,
        element: args.element,
        paths: args.paths,
        timeoutMs: args.timeoutMs,
        humanize: args.humanize,
      });

      return `**Uploaded** ${result.files} file(s) via ${result.mode} mode`;
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
