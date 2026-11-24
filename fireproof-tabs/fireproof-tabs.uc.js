// ==UserScript==
// @name           Fireproof Tabs
// @description    Mark a tab as "protected from Clear" (like DuckDuckGo's Fireproof), so the sidebar Clear button skips it.
// @include        main
// ==/UserScript==

// Loaded by Sine from this mod's own folder (listed in mods.json).
// How it works:
//  - Right-click a tab > "Protect from Clear". That sets the attribute
//    clear-protected on the tab and saves it in the session (SessionStore custom
//    tab value), so it survives restarts.
//  - For about 2 seconds after Clear is pressed (and only until you close a tab
//    yourself), closing a protected tab is skipped: tab removal is wrapped (removeTab, removeTabs, removeTabGroup). A
//    group holding a protected tab survives, with its other tabs closed.
//  - Settings are mod.zen-fireproof-tabs.* ; a setting that was never written
//    counts as ON.
// Timers: a bounded retry (20 x 1 s) to hook Clear, and three re-reads of the
// saved flags after startup. No endless loops.

(() => {
  const PREF_PREFIX = "mod.zen-fireproof-tabs.";
  const SS_KEY = "fireproofClear";
  const ATTR = "clear-protected";
  const ITEM_ID = "fireproof-tabs-item";
  const CLEAR_WINDOW_MS = 2000;
  const CLEAR_SELECTOR =
    '[class*="close-unpinned"], [id*="close-unpinned"], [class*="clear-tabs"], [id*="clear-tabs"]';
  let clearingUntil = 0;

  console.log("[FireproofTabs] loaded");

  function pref(name, fallback = true) {
    try {
      return Services.prefs.getBoolPref(PREF_PREFIX + name, fallback);
    } catch (_) {
      return fallback;
    }
  }

  const isProtected = (tab) => !!(tab && tab.hasAttribute && tab.hasAttribute(ATTR));

  function setProtected(tab, on) {
    if (!tab) return;
    try {
      if (on) {
        tab.setAttribute(ATTR, "true");
        SessionStore.setCustomTabValue(tab, SS_KEY, "true");
      } else {
        tab.removeAttribute(ATTR);
        SessionStore.deleteCustomTabValue(tab, SS_KEY);
      }
    } catch (err) {
      console.error("[FireproofTabs] could not save the flag:", err);
    }
  }

  // ---- Restore flags after a restart ----
  function restoreTab(tab) {
    try {
      if (tab && SessionStore.getCustomTabValue(tab, SS_KEY) === "true") {
        tab.setAttribute(ATTR, "true");
      }
    } catch (_) {}
  }
  function restoreAll() {
    try {
      for (const tab of gBrowser.tabs) restoreTab(tab);
    } catch (_) {}
  }
  window.addEventListener("SSTabRestoring", (e) => restoreTab(e.target));
  window.addEventListener("SSTabRestored", (e) => restoreTab(e.target));
  restoreAll();
  setTimeout(restoreAll, 3000);
  setTimeout(restoreAll, 10000);

  // ---- Marker on/off follows the "show-marker" setting live ----
  function applyMarkerAttribute() {
    try {
      document.documentElement.toggleAttribute("fireproof-marker", pref("show-marker"));
    } catch (_) {}
  }
  applyMarkerAttribute();
  const markerObserver = { observe: applyMarkerAttribute };
  try {
    Services.prefs.addObserver(PREF_PREFIX + "show-marker", markerObserver);
  } catch (_) {}

  // ---- "Slide the close button in" follows its setting live ----
  function applySlideAttribute() {
    try {
      document.documentElement.toggleAttribute("fireproof-x-slide", pref("slide-close-button"));
    } catch (_) {}
  }
  applySlideAttribute();
  const slideObserver = { observe: applySlideAttribute };
  try {
    Services.prefs.addObserver(PREF_PREFIX + "slide-close-button", slideObserver);
  } catch (_) {}

  // ---- Tab right-click menu entry ----
  // Which tab(s) the menu was opened on. This runs while the menu is opening,
  // BEFORE Firefox updates TabContextMenu.contextTab, so that value is stale (it
  // was the cause of protecting the tab you were on instead of the clicked one).
  // popup.triggerNode is the element that was right-clicked: use its tab.
  function menuTabs(popup) {
    let clicked = null;
    try {
      clicked = popup.triggerNode?.closest?.("tab") || null;
    } catch (_) {}
    if (!clicked) {
      try {
        clicked = window.TabContextMenu?.contextTab || null;
      } catch (_) {}
    }
    if (!clicked) clicked = gBrowser.selectedTab;
    let tabs = [clicked];
    try {
      // Right-clicked a tab that is part of a multi-selection: apply to all of them.
      if (clicked?.multiselected && gBrowser.selectedTabs?.length) {
        tabs = [...gBrowser.selectedTabs];
      }
    } catch (_) {}
    return tabs.filter(Boolean);
  }

  document.addEventListener(
    "popupshowing",
    (event) => {
      const popup = event.target;
      if (!popup || popup.id !== "tabContextMenu") return;
      let item = popup.querySelector("#" + ITEM_ID);
      if (!item) {
        item = document.createXULElement("menuitem");
        item.id = ITEM_ID;
        item.addEventListener("command", () => {
          const tabs = item._tabs || [];
          const turnOn = !tabs.every(isProtected);
          for (const tab of tabs) setProtected(tab, turnOn);
        });
        const anchor = popup.querySelector("#context_closeTab");
        if (anchor) popup.insertBefore(item, anchor);
        else popup.appendChild(item);
      }
      // Pinned and essential tabs are already skipped by Clear.
      const tabs = menuTabs(popup).filter((t) => !t.pinned && !t.hasAttribute("zen-essential"));
      item._tabs = tabs;
      item.hidden = !pref("menu-entry") || !tabs.length;
      item.setAttribute(
        "label",
        tabs.length && tabs.every(isProtected) ? "Remove Clear Protection" : "Protect from Clear"
      );
    },
    true
  );

  // ---- Measure the close button once so the lock's slide matches it ----
  // On the first hover of a protected tab the X is shown; its width (plus margins)
  // is how far the lock jumps. Stored as --fireproof-slide for chrome.css, and the
  // tab is marked fireproof-hovered so the slide-back animation only runs after that.
  window.addEventListener(
    "mouseover",
    (e) => {
      try {
        const tab = e.target?.closest?.("tab[clear-protected]");
        if (!tab) return;
        tab.setAttribute("fireproof-hovered", "true");
        if (window.__fireproofSlideMeasured) return;
        const btn = tab.querySelector(".tab-close-button");
        if (!btn) return;
        const width = btn.getBoundingClientRect().width;
        if (width > 0) {
          const cs = getComputedStyle(btn);
          const total =
            width + (parseFloat(cs.marginInlineStart) || 0) + (parseFloat(cs.marginInlineEnd) || 0);
          document.documentElement.style.setProperty("--fireproof-slide", Math.round(total) + "px");
          window.__fireproofSlideMeasured = true;
        }
      } catch (_) {}
    },
    true
  );

  // ---- Skip protected tabs while Clear is running ----
  const inClearWindow = () => pref("enabled") && Date.now() < clearingUntil;
  const beginClearWindow = () => {
    clearingUntil = Date.now() + CLEAR_WINDOW_MS;
  };
  // Closing a tab yourself (its X button, middle click, Ctrl+W, or the right-click
  // Close entries) always works, even on a protected tab: those actions end the
  // protection window at once, so only Clear is ever blocked.
  const cancelClearWindow = () => {
    clearingUntil = 0;
  };
  window.addEventListener(
    "mousedown",
    (e) => {
      try {
        if (e.target?.closest?.(".tab-close-button")) cancelClearWindow();
      } catch (_) {}
    },
    true
  );
  window.addEventListener(
    "mouseup",
    (e) => {
      try {
        if (e.button === 1 && e.target?.closest?.("tab")) cancelClearWindow();
      } catch (_) {}
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "w" || e.key === "W" || e.key === "F4")) {
        cancelClearWindow();
      }
    },
    true
  );
  document.addEventListener(
    "command",
    (e) => {
      const id = e.target && e.target.id;
      if (typeof id === "string" && id.startsWith("context_close")) cancelClearWindow();
    },
    true
  );

  function patchBrowser() {
    if (gBrowser.__fireproofPatched) return;
    gBrowser.__fireproofPatched = true;
    const origRemoveTab = gBrowser.removeTab;
    const origRemoveTabs = gBrowser.removeTabs;
    const origRemoveTabGroup = gBrowser.removeTabGroup;

    if (typeof origRemoveTab === "function") {
      gBrowser.removeTab = function (tab, ...rest) {
        if (inClearWindow() && isProtected(tab)) return undefined;
        return origRemoveTab.call(this, tab, ...rest);
      };
    }
    if (typeof origRemoveTabs === "function") {
      gBrowser.removeTabs = function (tabs, ...rest) {
        if (inClearWindow() && tabs) {
          tabs = Array.from(tabs).filter((t) => !isProtected(t));
        }
        return origRemoveTabs.call(this, tabs, ...rest);
      };
    }
    if (typeof origRemoveTabGroup === "function") {
      gBrowser.removeTabGroup = function (group, ...rest) {
        if (inClearWindow() && group) {
          let list = [];
          try {
            list = Array.from(group.tabs || []);
          } catch (_) {}
          if (list.some(isProtected)) {
            // Keep the group and its protected tabs; close the others.
            for (const t of list) if (!isProtected(t)) gBrowser.removeTab(t);
            return undefined;
          }
        }
        return origRemoveTabGroup.call(this, group, ...rest);
      };
    }
    console.log("[FireproofTabs] hooked tab removal");
  }
  patchBrowser();

  // Start the protection window when Clear runs: wrap closeAllUnpinnedTabs if it
  // exists (covers any trigger), and listen for a click on the Clear button.
  function hookClearFunction() {
    for (const owner of [window.gZenWorkspaces, window.gBrowser]) {
      const fn = owner && owner.closeAllUnpinnedTabs;
      if (typeof fn === "function" && !fn.__fireproofWrapped) {
        const wrapped = function (...args) {
          beginClearWindow();
          return fn.apply(this, args);
        };
        wrapped.__fireproofWrapped = true;
        owner.closeAllUnpinnedTabs = wrapped;
        console.log("[FireproofTabs] hooked closeAllUnpinnedTabs");
      }
    }
  }
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
          console.log("[FireproofTabs] Clear button clicked: protected tabs are skipped for", CLEAR_WINDOW_MS, "ms");
          beginClearWindow();
          return;
        }
      }
    },
    true
  );
})();
