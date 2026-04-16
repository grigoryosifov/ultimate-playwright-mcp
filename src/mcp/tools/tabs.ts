/**
 * browser_tabs tool - manage browser tabs with targetId-based isolation and
 * logical tab-group support.
 */

import type { ServerConfig } from "../../config.js";
import type { RegisterToolFn } from "../types.js";
import {
  listPagesViaPlaywright,
  createPageViaPlaywright,
  closePageByTargetIdViaPlaywright,
  focusPageByTargetIdViaPlaywright,
} from "../../browser/pw-session.js";
import { preserveFrontmostApp } from "../../utils/macos-focus.js";
import {
  addTabToGroup,
  removeTabFromGroup,
  getTabsInGroup,
  getGroupForTab,
  getTabGroup,
  pruneStaleTargets,
  setChromeGroupId,
  getChromeTabId,
} from "../../browser/tab-groups.js";
import {
  groupTabsVisually,
  isTabGrouperAvailable,
  createTabViaExtension,
  closeTabViaExtension,
} from "../../browser/chrome-tab-groups.js";

export function registerBrowserTabsTool(
  register: RegisterToolFn,
  config: ServerConfig,
) {
  register(
    "browser_tabs",
    "Manage browser tabs. When using tab groups (recommended for multi-user), pass groupId to " +
      "scope operations to your group's tabs only.\n\n" +
      "Actions:\n" +
      "- 'list': Show tabs. With groupId → only your group's tabs. Without → all tabs.\n" +
      "- 'new': Create a tab. If groupId is provided, the tab is added to that group.\n" +
      "- 'close': Close a tab by index or targetId.\n" +
      "- 'select': Focus a tab by index or targetId.\n\n" +
      "⚡ IMPORTANT: Create a tab group first for multi-user isolation. Ungrouped tabs remain available as a fallback for local manual testing.",
    {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "new", "close", "select"],
          description: "Tab action to perform",
        },
        groupId: {
          type: "string",
          description:
            "Tab group name to scope this operation to (from browser_tab_group). " +
            "Recommended for multi-user isolation.",
        },
        url: {
          type: "string",
          description: "URL for 'new' action (defaults to about:blank)",
        },
        index: {
          type: "number",
          description:
            "Tab index for 'close' or 'select' actions (relative to group if groupId is set)",
        },
        targetId: {
          type: "string",
          description: "Target ID for 'close' or 'select' actions (alternative to index)",
        },
      },
      required: ["action"],
    },
    async (args: {
      action: string;
      groupId?: string;
      url?: string;
      index?: number;
      targetId?: string;
    }) => {
      if (!config.cdpEndpoint) {
        throw new Error("CDP endpoint not configured");
      }

      const { action, groupId, url, index, targetId } = args;
      const cdp = config.cdpEndpoint;

      async function getScopedTabs() {
        const allTabs = await listPagesViaPlaywright({ cdpUrl: cdp });
        pruneStaleTargets(cdp, allTabs.map((tab) => tab.targetId));

        if (!groupId) {
          return allTabs;
        }

        const group = getTabGroup(cdp, groupId);
        if (!group) {
          throw new Error(
            `Tab group not found: ${groupId}. Create one first with browser_tab_group.`,
          );
        }

        const groupTargetIds = new Set(getTabsInGroup(cdp, groupId));
        return allTabs.filter((tab) => groupTargetIds.has(tab.targetId));
      }

      async function resolveTarget(
        scopedTabs: Array<{ targetId: string; title: string; url: string }>,
      ): Promise<string> {
        if (targetId) {
          if (groupId) {
            const tabGroup = getGroupForTab(cdp, targetId);
            if (tabGroup !== groupId) {
              throw new Error(`Tab ${targetId} does not belong to group ${groupId}.`);
            }
          }
          return targetId;
        }

        if (typeof index === "number") {
          const tab = scopedTabs[index];
          if (!tab) {
            throw new Error(
              `No tab at index ${index}` + (groupId ? ` in group ${groupId}` : ""),
            );
          }
          return tab.targetId;
        }

        throw new Error("Either 'index' or 'targetId' is required");
      }

      switch (action) {
        case "list": {
          const tabs = await getScopedTabs();
          if (tabs.length === 0) {
            if (groupId) {
              return `**No tabs in group ${groupId}.**\nCreate one with browser_tabs({ action: 'new', groupId: '${groupId}', url: '...' })`;
            }
            return "**No tabs open.**";
          }

          const output = tabs
            .map((tab, tabIndex) => {
              const groupLabel = !groupId
                ? (() => {
                    const tabGroup = getGroupForTab(cdp, tab.targetId);
                    return tabGroup ? ` [${tabGroup}]` : " [ungrouped]";
                  })()
                : "";

              return (
                `[${tabIndex}] **targetId: ${tab.targetId}**${groupLabel}\n` +
                `    ${tab.title || "(no title)"}\n` +
                `    ${tab.url}`
              );
            })
            .join("\n\n");

          const label = groupId ? `in group ${groupId}` : "total";
          return `**${tabs.length} tab(s)** ${label}\n\n${output}`;
        }

        case "new": {
          if (groupId && !getTabGroup(cdp, groupId)) {
            throw new Error(
              `Tab group not found: ${groupId}. Create one first with browser_tab_group.`,
            );
          }

          const tabUrl = url || "about:blank";

          const { resultTargetId } = await preserveFrontmostApp(async () => {
            let resultTargetId: string;
            let chromeTabId: number | undefined;

            const hasExtension = await isTabGrouperAvailable(cdp);
            if (hasExtension) {
              try {
                const extTab = await createTabViaExtension(cdp, tabUrl);
                resultTargetId = extTab.targetId;
                chromeTabId = extTab.chromeTabId;
              } catch {
                const pwTab = await createPageViaPlaywright({ cdpUrl: cdp, url: tabUrl });
                resultTargetId = pwTab.targetId;
              }
            } else {
              const pwTab = await createPageViaPlaywright({ cdpUrl: cdp, url: tabUrl });
              resultTargetId = pwTab.targetId;
            }

            if (groupId) {
              addTabToGroup(cdp, resultTargetId, groupId, chromeTabId);

              if (chromeTabId !== undefined) {
                const group = getTabGroup(cdp, groupId);
                if (group) {
                  try {
                    const visual = await groupTabsVisually(
                      cdp,
                      [chromeTabId],
                      group.name,
                      group.color,
                      group.chromeGroupId,
                    );
                    if (!group.chromeGroupId) {
                      setChromeGroupId(groupId, visual.groupId);
                    }
                  } catch {
                    // Visual grouping is best-effort only.
                  }
                }
              }
            }

            return { resultTargetId };
          });

          const groupLabel = groupId ?? "ungrouped";
          const note = groupId
            ? ""
            : "\nNote: created without a tab group. This is intended as a fallback for local manual testing.";

          return (
            `**Tab created**\n` +
            `**targetId: ${resultTargetId}** ← Use this with other browser tools\n` +
            `Group: ${groupLabel}\n` +
            `URL: ${tabUrl}` +
            note
          );
        }

        case "close": {
          const tabs = await getScopedTabs();
          const resolvedTargetId = await resolveTarget(tabs);
          const storedChromeTabId = getChromeTabId(cdp, resolvedTargetId);

          if (storedChromeTabId !== null) {
            try {
              await closeTabViaExtension(cdp, storedChromeTabId);
            } catch {
              await closePageByTargetIdViaPlaywright({
                cdpUrl: cdp,
                targetId: resolvedTargetId,
              });
            }
          } else {
            await closePageByTargetIdViaPlaywright({
              cdpUrl: cdp,
              targetId: resolvedTargetId,
            });
          }

          removeTabFromGroup(cdp, resolvedTargetId);
          return `**Tab closed:** ${resolvedTargetId}`;
        }

        case "select": {
          const tabs = await getScopedTabs();
          const resolvedTargetId = await resolveTarget(tabs);

          await focusPageByTargetIdViaPlaywright({
            cdpUrl: cdp,
            targetId: resolvedTargetId,
          });

          return `**Tab focused:** ${resolvedTargetId}`;
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  );
}
