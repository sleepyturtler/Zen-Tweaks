// ==UserScript==
// @name           Unload Grouped Tabs
// @description    Adds "Unload All Tabs" to the Advanced Tab Groups right-click menu.
// @include        main
// ==/UserScript==

// Place this file in your profile's chrome/JS folder.
// Advanced Tab Groups builds one shared menu (id advanced-tab-groups-context-menu)
// and remembers the clicked group in advancedTabGroups._contextMenuCurrentGroup.
// This script adds one item to that menu the first time it opens.
// No loops, timers or observers.

(() => {
  const MENU_ID = "advanced-tab-groups-context-menu";
  const ITEM_ID = "unload-group-tabs-item";

  console.log("[UnloadGroupTabs] loaded");

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
    },
    true
  );
})();
