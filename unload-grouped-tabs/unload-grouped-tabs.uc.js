// ==UserScript==
// @name           Unload Grouped Tabs
// @description    Adds "Unload All Tabs" to the Advanced Tab Groups right-click menu, and makes the sidebar Clear button close tab groups and folders (and their tabs) too.
// @include        main
// ==/UserScript==

// Loaded by Sine from this mod's own folder (listed in mods.json).
// Advanced Tab Groups builds one shared menu (id advanced-tab-groups-context-menu)
// and remembers the clicked group in advancedTabGroups._contextMenuCurrentGroup.
// Each tweak can be switched off in the mod's settings (mod.unload-grouped-tabs.*
// preferences). A tweak is ON when its preference is unset, so nothing depends on
// Sine having written the defaults.
// Timers: only a bounded retry (20 x 1 s) to hook Clear. No endless loops.

(() => {
  const MENU_ID = "advanced-tab-groups-context-menu";
  const ITEM_ID = "unload-group-tabs-item";

  console.log("[UnloadGroupTabs] loaded");

  const PREF_PREFIX = "mod.unload-grouped-tabs.";
  function pref(name, fallback = true) {
    try {
      return Services.prefs.getBoolPref(PREF_PREFIX + name, fallback);
    } catch (_) {
      return fallback;
    }
  }

  // Dimmed text for unloaded tabs in groups is done in chrome.css, switched by
  // an attribute on the window root that follows the "dim-text" preference live.
  function applyDimAttribute() {
    try {
      document.documentElement.toggleAttribute("unloaded-text-dim", pref("dim-text"));
    } catch (_) {}
  }
  applyDimAttribute();
  const dimObserver = { observe: applyDimAttribute };
  try {
    Services.prefs.addObserver(PREF_PREFIX + "dim-text", dimObserver);
  } catch (_) {}

  // Label-overlap fix for the Zen Folder Tree Connectors mod follows its setting live.
  function applyTreeFixAttribute() {
    try {
      document.documentElement.toggleAttribute("unload-tree-fix", pref("tree-overlap-fix"));
    } catch (_) {}
  }
  applyTreeFixAttribute();
  const treeFixObserver = { observe: applyTreeFixAttribute };
  try {
    Services.prefs.addObserver(PREF_PREFIX + "tree-overlap-fix", treeFixObserver);
  } catch (_) {}

  function currentGroup(popup) {
    return (
      globalThis.advancedTabGroups?._contextMenuCurrentGroup ||
      popup._lastGroup ||
      null
    );
  }

  function tabsOf(group) {
    const found = new Set();
    if (group.tabs) {
      for (const t of group.tabs) found.add(t);
    }
    for (const t of group.querySelectorAll("tab")) found.add(t);
    return [...found];
  }

  function unloadAll(group) {
    if (!group) {
      console.warn("[UnloadGroupTabs] no group found for this menu");
      return;
    }
    let count = 0;
    for (const tab of tabsOf(group)) {
      // The selected tab can't be unloaded; already-unloaded tabs are skipped.
      if (tab.selected || tab.hasAttribute("pending")) continue;
      if (tab.hasAttribute("zen-empty-tab")) continue;
      try {
        gBrowser.discardBrowser(tab, true);
        count++;
      } catch (err) {
        console.error("[UnloadGroupTabs] could not unload a tab:", err);
      }
    }
    console.log("[UnloadGroupTabs] unloaded", count, "tab(s) in group", group.id);
  }

  document.addEventListener(
    "popupshowing",
    (event) => {
      const popup = event.target;
      if (!popup || popup.id !== MENU_ID) return;

      let item = popup.querySelector("#" + ITEM_ID);
      if (!item) {
        item = document.createXULElement("menuitem");
        item.id = ITEM_ID;
        item.setAttribute("label", "Unload All Tabs");
        item.addEventListener("command", () => unloadAll(currentGroup(popup)));
        // Sit just above "Ungroup" (that item has the class ungroup-tabs).
        const ungroup = popup.querySelector(".ungroup-tabs");
        if (ungroup) popup.insertBefore(item, ungroup);
        else popup.appendChild(item);
        console.log("[UnloadGroupTabs] added to", MENU_ID);
      }
      item.hidden = !pref("menu-entry");
    },
    true
  );
  // ------------------------------------------------------------------
  // Clear also clears groups and the tabs inside them.
  // Tidy Tabs patches Zen's closeAllUnpinnedTabs to PRESERVE groups, so Clear
  // used to leave every group behind. Two hooks, whichever fires first runs
  // the group cleanup once (a short throttle stops it running twice):
  //  1. wrap closeAllUnpinnedTabs if it exists on gZenWorkspaces or gBrowser
  //  2. a click listener on the Clear button itself (matched by class, or by
  //     its text "Clear" in English), as a fallback
  // The tab you are currently on is kept, and so is its group (setting "keep-current").
  // ------------------------------------------------------------------
  const GROUP_SELECTOR = "tab-group, zen-folder";
  const CLEAR_SELECTOR =
    '[class*="close-unpinned"], [id*="close-unpinned"], [class*="clear-tabs"], [id*="clear-tabs"]';
  let lastClear = 0;

  function isFolder(g) {
    return (
      g.localName === "zen-folder" ||
      g.isZenFolder === true ||
      g.classList?.contains("zen-folder") ||
      g.hasAttribute?.("zen-folder")
    );
  }

  function closableTabs(g) {
    const set = new Set();
    try {
      if (isFolder(g) && g.allItemsRecursive) {
        for (const item of g.allItemsRecursive) if (gBrowser.isTab(item)) set.add(item);
      }
    } catch (_) {}
    try {
      if (g.tabs) for (const t of g.tabs) set.add(t);
    } catch (_) {}
    for (const t of g.querySelectorAll("tab")) set.add(t);
    return [...set].filter(
      (t) => t && !t.pinned && !t.hasAttribute("zen-essential") && !t.hasAttribute("zen-empty-tab")
    );
  }

  function clearGroups() {
    if (!pref("clear-groups")) return;
    const now = Date.now();
    if (now - lastClear < 800) return;
    lastClear = now;
    const root = window.gZenWorkspaces?.activeWorkspaceStrip || document;
    const all = [...root.querySelectorAll(GROUP_SELECTOR)].filter(
      (g) =>
        !g.hasAttribute("split-view-group") &&
        !g.closest("zen-library, zen-library-spaces-section")
    );
    // Outermost groups only: closing one closes everything nested inside it.
    const top = all.filter((g) => !all.some((o) => o !== g && o.contains(g)));
    let groups = 0;
    let tabs = 0;
    for (const g of top) {
      try {
        const list = closableTabs(g);
        // Tabs to spare: the one you are on (setting "keep-current") and any tab
        // protected by the Fireproof Tabs mod (attribute clear-protected).
        const spare = (t) =>
          t.hasAttribute("clear-protected") || (pref("keep-current") && t.selected);
        if (list.some(spare)) {
          // Keep those tabs (and so the group); close the rest of it.
          for (const t of list) {
            if (!spare(t)) {
              gBrowser.removeTab(t);
              tabs++;
            }
          }
          continue;
        }
        if (isFolder(g)) {
          for (const t of list) gBrowser.removeTab(t);
          if (typeof g.delete === "function") g.delete();
        } else {
          gBrowser.removeTabGroup(g);
        }
        groups++;
        tabs += list.length;
      } catch (err) {
        console.error("[UnloadGroupedTabs] could not clear a group:", err);
      }
    }
    console.log("[UnloadGroupedTabs] Clear: closed", groups, "group(s),", tabs, "tab(s)");
  }

  let hooked = false;
  function hookClearFunction() {
    for (const owner of [window.gZenWorkspaces, window.gBrowser]) {
      const fn = owner && owner.closeAllUnpinnedTabs;
      if (typeof fn === "function" && !fn.__unloadGroupedWrapped) {
        const wrapped = function (...args) {
          try {
            clearGroups();
          } catch (err) {
            console.error("[UnloadGroupedTabs] Clear hook error:", err);
          }
          return fn.apply(this, args);
        };
        wrapped.__unloadGroupedWrapped = true;
        owner.closeAllUnpinnedTabs = wrapped;
        hooked = true;
        console.log("[UnloadGroupedTabs] hooked closeAllUnpinnedTabs");
      }
    }
  }
  // Bounded retries (20 x 1s), not a forever loop: Zen creates its workspace
  // object a little after startup.
  let tries = 0;
  const hookTimer = setInterval(() => {
    hookClearFunction();
    if (++tries >= 20) clearInterval(hookTimer);
  }, 1000);

  window.addEventListener(
    "click",
    (event) => {
      for (const node of event.composedPath()) {
        if (!node || node.nodeType !== 1) continue;
        // Never fire from inside a tab or group (a tab could be titled "Clear").
        if (node.localName === "tab" || node.localName === "tab-group" || node.localName === "zen-folder") return;
        const isClear =
          node.matches?.(CLEAR_SELECTOR) ||
          ((node.textContent || "").trim() === "Clear" &&
            node.closest?.("#tabbrowser-tabs, #tabbrowser-arrowscrollbox, zen-workspace") &&
            !node.closest?.("tab, tab-group, zen-folder"));
        if (isClear) {
          console.log("[UnloadGroupedTabs] Clear button clicked");
          clearGroups();
          return;
        }
      }
    },
    true
  );


})();
