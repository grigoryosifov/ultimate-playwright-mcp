/**
 * Extracted from OpenClaw (https://github.com/openclaw/openclaw)
 * Original: src/browser/pw-session.ts
 * License: MIT
 *
 * Modified for ultimate-playwright-mcp:
 * - Updated import paths to use our simplified utilities
 * - Removed logging dependencies
 */

import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
  Response,
} from "playwright-core";
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { formatErrorMessage } from "../utils/errors.js";
import { getHeadersWithAuth } from "./cdp.helpers.js";
import { getChromeWebSocketUrl } from "./chrome.js";
import { STEALTH_SCRIPT, isStealthInjectionEnabled } from "./stealth.js";

// ---------- Persistent ref store (file-based) ----------
const REFS_STORE_DIR = path.join(os.tmpdir(), "ultimate-playwright-mcp-refs");
const REFS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function ensureRefsDir(): void {
  try {
    if (!fs.existsSync(REFS_STORE_DIR)) {
      fs.mkdirSync(REFS_STORE_DIR, { recursive: true });
    }
  } catch {
    // best-effort
  }
}

function refsFilePath(key: string): string {
  // Sanitise key for filename
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
  return path.join(REFS_STORE_DIR, `${safe}.json`);
}

function persistRefs(key: string, entry: RoleRefsCacheEntry): void {
  ensureRefsDir();
  try {
    const data = JSON.stringify({ ts: Date.now(), ...entry });
    fs.writeFileSync(refsFilePath(key), data, "utf-8");
  } catch {
    // best-effort
  }
}

function loadPersistedRefs(key: string): RoleRefsCacheEntry | null {
  try {
    const fp = refsFilePath(key);
    if (!fs.existsSync(fp)) return null;
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
      ts: number;
      refs: RoleRefs;
      frameSelector?: string;
      mode?: NonNullable<PageState["roleRefsMode"]>;
    };
    if (Date.now() - raw.ts > REFS_TTL_MS) {
      fs.unlinkSync(fp);
      return null;
    }
    return {
      refs: raw.refs,
      ...(raw.frameSelector ? { frameSelector: raw.frameSelector } : {}),
      ...(raw.mode ? { mode: raw.mode } : {}),
    };
  } catch {
    return null;
  }
}
// ---------- End persistent ref store ----------

export type BrowserConsoleMessage = {
  type: string;
  text: string;
  timestamp: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
};

export type BrowserPageError = {
  message: string;
  name?: string;
  stack?: string;
  timestamp: string;
};

export type BrowserNetworkRequest = {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  ok?: boolean;
  failureText?: string;
};

type SnapshotForAIResult = { full: string; incremental?: string };
type SnapshotForAIOptions = { timeout?: number; track?: string };

export type WithSnapshotForAI = {
  _snapshotForAI?: (options?: SnapshotForAIOptions) => Promise<SnapshotForAIResult>;
};

type TargetInfoResponse = {
  targetInfo?: {
    targetId?: string;
  };
};

type ConnectedBrowser = {
  browser: Browser;
  cdpUrl: string;
};

type PageState = {
  console: BrowserConsoleMessage[];
  errors: BrowserPageError[];
  requests: BrowserNetworkRequest[];
  requestIds: WeakMap<Request, string>;
  nextRequestId: number;
  armIdUpload: number;
  armIdDialog: number;
  armIdDownload: number;
  /**
   * Role-based refs from the last role snapshot (e.g. e1/e2).
   * Mode "role" refs are generated from ariaSnapshot and resolved via getByRole.
   * Mode "aria" refs are Playwright aria-ref ids and resolved via `aria-ref=...`.
   */
  roleRefs?: Record<string, { role: string; name?: string; nth?: number }>;
  roleRefsMode?: "role" | "aria";
  roleRefsFrameSelector?: string;
};

type RoleRefs = NonNullable<PageState["roleRefs"]>;
type RoleRefsCacheEntry = {
  refs: RoleRefs;
  frameSelector?: string;
  mode?: NonNullable<PageState["roleRefsMode"]>;
};

type ContextState = {
  traceActive: boolean;
};

const pageStates = new WeakMap<Page, PageState>();
const contextStates = new WeakMap<BrowserContext, ContextState>();
const observedContexts = new WeakSet<BrowserContext>();
const observedPages = new WeakSet<Page>();

// Best-effort cache to make role refs stable even if Playwright returns a different Page object
// for the same CDP target across requests.
const roleRefsByTarget = new Map<string, RoleRefsCacheEntry>();
const MAX_ROLE_REFS_CACHE = 50;

const MAX_CONSOLE_MESSAGES = 500;
const MAX_PAGE_ERRORS = 200;
const MAX_NETWORK_REQUESTS = 500;

let cached: ConnectedBrowser | null = null;
let connecting: Promise<ConnectedBrowser> | null = null;

function normalizeCdpUrl(raw: string) {
  return raw.replace(/\/$/, "");
}

function roleRefsKey(cdpUrl: string, targetId: string) {
  return `${normalizeCdpUrl(cdpUrl)}::${targetId}`;
}

export function rememberRoleRefsForTarget(opts: {
  cdpUrl: string;
  targetId: string;
  refs: RoleRefs;
  frameSelector?: string;
  mode?: NonNullable<PageState["roleRefsMode"]>;
}): void {
  const targetId = opts.targetId.trim();
  if (!targetId) {
    return;
  }
  const key = roleRefsKey(opts.cdpUrl, targetId);
  const entry: RoleRefsCacheEntry = {
    refs: opts.refs,
    ...(opts.frameSelector ? { frameSelector: opts.frameSelector } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
  };
  roleRefsByTarget.set(key, entry);
  while (roleRefsByTarget.size > MAX_ROLE_REFS_CACHE) {
    const first = roleRefsByTarget.keys().next();
    if (first.done) {
      break;
    }
    roleRefsByTarget.delete(first.value);
  }
  // Persist to disk so refs survive across process restarts (mcporter CLI)
  persistRefs(key, entry);
}

export function storeRoleRefsForTarget(opts: {
  page: Page;
  cdpUrl: string;
  targetId?: string;
  refs: RoleRefs;
  frameSelector?: string;
  mode: NonNullable<PageState["roleRefsMode"]>;
}): void {
  const state = ensurePageState(opts.page);
  state.roleRefs = opts.refs;
  state.roleRefsFrameSelector = opts.frameSelector;
  state.roleRefsMode = opts.mode;
  if (!opts.targetId?.trim()) {
    return;
  }
  rememberRoleRefsForTarget({
    cdpUrl: opts.cdpUrl,
    targetId: opts.targetId,
    refs: opts.refs,
    frameSelector: opts.frameSelector,
    mode: opts.mode,
  });
}

export function restoreRoleRefsForTarget(opts: {
  cdpUrl: string;
  targetId?: string;
  page: Page;
}): void {
  const targetId = opts.targetId?.trim() || "";
  if (!targetId) {
    return;
  }
  const key = roleRefsKey(opts.cdpUrl, targetId);
  let entry = roleRefsByTarget.get(key);
  // Fall back to disk-persisted refs (survives across mcporter CLI invocations)
  if (!entry) {
    entry = loadPersistedRefs(key) ?? undefined;
    if (entry) {
      roleRefsByTarget.set(key, entry);
    }
  }
  if (!entry) {
    return;
  }
  const state = ensurePageState(opts.page);
  if (state.roleRefs) {
    return;
  }
  state.roleRefs = entry.refs;
  state.roleRefsFrameSelector = entry.frameSelector;
  state.roleRefsMode = entry.mode;
}

export function ensurePageState(page: Page): PageState {
  const existing = pageStates.get(page);
  if (existing) {
    return existing;
  }

  const state: PageState = {
    console: [],
    errors: [],
    requests: [],
    requestIds: new WeakMap(),
    nextRequestId: 0,
    armIdUpload: 0,
    armIdDialog: 0,
    armIdDownload: 0,
  };
  pageStates.set(page, state);

  if (!observedPages.has(page)) {
    observedPages.add(page);
    page.on("console", (msg: ConsoleMessage) => {
      const entry: BrowserConsoleMessage = {
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
        location: msg.location(),
      };
      state.console.push(entry);
      if (state.console.length > MAX_CONSOLE_MESSAGES) {
        state.console.shift();
      }
    });
    page.on("pageerror", (err: Error) => {
      state.errors.push({
        message: err?.message ? String(err.message) : String(err),
        name: err?.name ? String(err.name) : undefined,
        stack: err?.stack ? String(err.stack) : undefined,
        timestamp: new Date().toISOString(),
      });
      if (state.errors.length > MAX_PAGE_ERRORS) {
        state.errors.shift();
      }
    });
    page.on("request", (req: Request) => {
      state.nextRequestId += 1;
      const id = `r${state.nextRequestId}`;
      state.requestIds.set(req, id);
      state.requests.push({
        id,
        timestamp: new Date().toISOString(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
      });
      if (state.requests.length > MAX_NETWORK_REQUESTS) {
        state.requests.shift();
      }
    });
    page.on("response", (resp: Response) => {
      const req = resp.request();
      const id = state.requestIds.get(req);
      if (!id) {
        return;
      }
      let rec: BrowserNetworkRequest | undefined;
      for (let i = state.requests.length - 1; i >= 0; i -= 1) {
        const candidate = state.requests[i];
        if (candidate && candidate.id === id) {
          rec = candidate;
          break;
        }
      }
      if (!rec) {
        return;
      }
      rec.status = resp.status();
      rec.ok = resp.ok();
    });
    page.on("requestfailed", (req: Request) => {
      const id = state.requestIds.get(req);
      if (!id) {
        return;
      }
      let rec: BrowserNetworkRequest | undefined;
      for (let i = state.requests.length - 1; i >= 0; i -= 1) {
        const candidate = state.requests[i];
        if (candidate && candidate.id === id) {
          rec = candidate;
          break;
        }
      }
      if (!rec) {
        return;
      }
      rec.failureText = req.failure()?.errorText;
      rec.ok = false;
    });
    page.on("close", () => {
      pageStates.delete(page);
      observedPages.delete(page);
    });
  }

  return state;
}

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), ".ultimate-playwright-mcp", "downloads");

/**
 * Enable downloads for a page via CDP Page.setDownloadBehavior.
 * This supplements the browser-level setting from the daemon.
 */
async function enablePageDownloads(page: Page): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Page.setDownloadBehavior" as never, {
        behavior: "allow",
        downloadPath: DEFAULT_DOWNLOAD_DIR,
      } as never);
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {
    // Non-fatal: some pages (e.g., about:blank) may not support CDP sessions
  }
}

/** Exported for unit tests (see tests/stealth-injection.test.ts). */
export function observeContext(context: BrowserContext) {
  if (observedContexts.has(context)) {
    return;
  }
  observedContexts.add(context);
  ensureContextState(context);

  // Inject the stealth script into every new page in this context — but only
  // for a browser we launched ourselves. When attached to the user's own Chrome
  // the patches fabricate detectable tells instead of hiding anything; see
  // setStealthInjectionEnabled() in ./stealth.ts for the full rationale.
  if (isStealthInjectionEnabled()) {
    context.addInitScript(STEALTH_SCRIPT).catch(() => {
      // Non-fatal: some contexts may not support addInitScript
    });
  }

  for (const page of context.pages()) {
    ensurePageState(page);
    enablePageDownloads(page).catch(() => {});
  }
  context.on("page", (page) => {
    ensurePageState(page);
    enablePageDownloads(page).catch(() => {});
  });
}

export function ensureContextState(context: BrowserContext): ContextState {
  const existing = contextStates.get(context);
  if (existing) {
    return existing;
  }
  const state: ContextState = { traceActive: false };
  contextStates.set(context, state);
  return state;
}

function observeBrowser(browser: Browser) {
  for (const context of browser.contexts()) {
    observeContext(context);
  }
}

async function connectBrowser(cdpUrl: string): Promise<ConnectedBrowser> {
  const normalized = normalizeCdpUrl(cdpUrl);
  if (cached?.cdpUrl === normalized) {
    return cached;
  }
  if (connecting) {
    return await connecting;
  }

  const connectWithRetry = async (): Promise<ConnectedBrowser> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const timeout = 5000 + attempt * 2000;
        const wsUrl = await getChromeWebSocketUrl(normalized, timeout).catch(() => null);
        const endpoint = wsUrl ?? normalized;
        const headers = getHeadersWithAuth(endpoint);
        const browser = await chromium.connectOverCDP(endpoint, { timeout, headers });
        const connected: ConnectedBrowser = { browser, cdpUrl: normalized };
        cached = connected;
        observeBrowser(browser);
        browser.on("disconnected", () => {
          if (cached?.browser === browser) {
            cached = null;
          }
        });
        return connected;
      } catch (err) {
        lastErr = err;
        const delay = 250 + attempt * 250;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (lastErr instanceof Error) {
      throw lastErr;
    }
    const message = lastErr ? formatErrorMessage(lastErr) : "CDP connect failed";
    throw new Error(message);
  };

  connecting = connectWithRetry().finally(() => {
    connecting = null;
  });

  return await connecting;
}

async function getAllPages(browser: Browser): Promise<Page[]> {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  return pages;
}

async function pageTargetId(page: Page): Promise<string | null> {
  const session = await page.context().newCDPSession(page);
  try {
    const info = (await session.send("Target.getTargetInfo")) as TargetInfoResponse;
    const targetId = String(info?.targetInfo?.targetId ?? "").trim();
    return targetId || null;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function findPageByTargetId(
  browser: Browser,
  targetId: string,
  cdpUrl?: string,
): Promise<Page | null> {
  const pages = await getAllPages(browser);
  // First, try the standard CDP session approach
  for (const page of pages) {
    const tid = await pageTargetId(page).catch(() => null);
    if (tid && tid === targetId) {
      return page;
    }
  }
  // If CDP sessions fail (e.g., extension relay blocks Target.attachToBrowserTarget),
  // fall back to URL-based matching using the /json/list endpoint
  if (cdpUrl) {
    try {
      const baseUrl = cdpUrl
        .replace(/\/+$/, "")
        .replace(/^ws:/, "http:")
        .replace(/\/cdp$/, "");
      const listUrl = `${baseUrl}/json/list`;
      const response = await fetch(listUrl, { headers: getHeadersWithAuth(listUrl) });
      if (response.ok) {
        const targets = (await response.json()) as Array<{
          id: string;
          url: string;
          title?: string;
        }>;
        const target = targets.find((t) => t.id === targetId);
        if (target) {
          // Try to find a page with matching URL
          const urlMatch = pages.filter((p) => p.url() === target.url);
          if (urlMatch.length === 1) {
            return urlMatch[0];
          }
          // If multiple URL matches, use index-based matching as fallback
          // This works when Playwright and the relay enumerate tabs in the same order
          if (urlMatch.length > 1) {
            const sameUrlTargets = targets.filter((t) => t.url === target.url);
            if (sameUrlTargets.length === urlMatch.length) {
              const idx = sameUrlTargets.findIndex((t) => t.id === targetId);
              if (idx >= 0 && idx < urlMatch.length) {
                return urlMatch[idx];
              }
            }
          }
        }
      }
    } catch {
      // Ignore fetch errors and fall through to return null
    }
  }
  return null;
}

export async function getPageForTargetId(opts: {
  cdpUrl: string;
  targetId?: string;
}): Promise<Page> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const pages = await getAllPages(browser);
  if (!pages.length) {
    throw new Error("No pages available in the connected browser.");
  }
  const first = pages[0];
  if (!opts.targetId) {
    return first;
  }
  const found = await findPageByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!found) {
    // Extension relays can block CDP attachment APIs (e.g. Target.attachToBrowserTarget),
    // which prevents us from resolving a page's targetId via newCDPSession(). If Playwright
    // only exposes a single Page, use it as a best-effort fallback.
    if (pages.length === 1) {
      return first;
    }
    throw new Error("tab not found");
  }
  return found;
}

export function refLocator(page: Page, ref: string) {
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;

  if (/^e\d+$/.test(normalized)) {
    const state = pageStates.get(page);
    if (state?.roleRefsMode === "aria") {
      const scope = state.roleRefsFrameSelector
        ? page.frameLocator(state.roleRefsFrameSelector)
        : page;
      return scope.locator(`aria-ref=${normalized}`);
    }
    const info = state?.roleRefs?.[normalized];
    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`,
      );
    }
    const scope = state?.roleRefsFrameSelector
      ? page.frameLocator(state.roleRefsFrameSelector)
      : page;
    const locAny = scope as unknown as {
      getByRole: (
        role: never,
        opts?: { name?: string; exact?: boolean },
      ) => ReturnType<Page["getByRole"]>;
    };
    const locator = info.name
      ? locAny.getByRole(info.role as never, { name: info.name, exact: true })
      : locAny.getByRole(info.role as never);
    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  return page.locator(`aria-ref=${normalized}`);
}

export async function closePlaywrightBrowserConnection(): Promise<void> {
  const cur = cached;
  cached = null;
  if (!cur) {
    return;
  }
  await cur.browser.close().catch(() => {});
}

/**
 * List all pages/tabs from the persistent Playwright connection.
 * Used for remote profiles where HTTP-based /json/list is ephemeral.
 */
export async function listPagesViaPlaywright(opts: { cdpUrl: string }): Promise<
  Array<{
    targetId: string;
    title: string;
    url: string;
    type: string;
  }>
> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const pages = await getAllPages(browser);
  const results: Array<{
    targetId: string;
    title: string;
    url: string;
    type: string;
  }> = [];

  for (const page of pages) {
    const tid = await pageTargetId(page).catch(() => null);
    if (tid) {
      results.push({
        targetId: tid,
        title: await page.title().catch(() => ""),
        url: page.url(),
        type: "page",
      });
    }
  }
  return results;
}

/**
 * Create a new page/tab using the persistent Playwright connection.
 * Used for remote profiles where HTTP-based /json/new is ephemeral.
 * Returns the new page's targetId and metadata.
 */
export async function createPageViaPlaywright(opts: { cdpUrl: string; url: string }): Promise<{
  targetId: string;
  title: string;
  url: string;
  type: string;
}> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  ensureContextState(context);

  const page = await context.newPage();
  ensurePageState(page);

  // Navigate to the URL
  const targetUrl = opts.url.trim() || "about:blank";
  if (targetUrl !== "about:blank") {
    await page.goto(targetUrl, { timeout: 30_000 }).catch(() => {
      // Navigation might fail for some URLs, but page is still created
    });
  }

  // Get the targetId for this page
  const tid = await pageTargetId(page).catch(() => null);
  if (!tid) {
    throw new Error("Failed to get targetId for new page");
  }

  return {
    targetId: tid,
    title: await page.title().catch(() => ""),
    url: page.url(),
    type: "page",
  };
}

/**
 * Close a page/tab by targetId using the persistent Playwright connection.
 * Used for remote profiles where HTTP-based /json/close is ephemeral.
 */
export async function closePageByTargetIdViaPlaywright(opts: {
  cdpUrl: string;
  targetId: string;
}): Promise<void> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const page = await findPageByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!page) {
    throw new Error("tab not found");
  }
  await page.close();
}

/**
 * Focus a page/tab by targetId using the persistent Playwright connection.
 * Used for remote profiles where HTTP-based /json/activate can be ephemeral.
 */
export async function focusPageByTargetIdViaPlaywright(opts: {
  cdpUrl: string;
  targetId: string;
}): Promise<void> {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const page = await findPageByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!page) {
    throw new Error("tab not found");
  }
  try {
    await page.bringToFront();
  } catch (err) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Page.bringToFront");
      return;
    } catch {
      throw err;
    } finally {
      await session.detach().catch(() => {});
    }
  }
}
