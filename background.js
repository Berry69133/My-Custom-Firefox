browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "hello") return;
  return Promise.resolve({
    text: "Hello from the background script!"
  });
});

console.log("Hello World extension loaded.");

let tabList = new Map();

async function openFaviconManager() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url ?? "";
  const tabTitle = tab?.title ?? "";
  const tabId = typeof tab?.id === "number" ? tab.id : "";

  await browser.windows.create({
    url: browser.runtime.getURL(
      `popup/popup.html?tabId=${encodeURIComponent(String(tabId))}&tabUrl=${encodeURIComponent(tabUrl)}&tabTitle=${encodeURIComponent(tabTitle)}`
    ),
    type: "popup",
    width: 420,
    height: 640
  });
}

function injectableFavicon(base64) {
  return `(function() {
    const existingFavicons = document.querySelectorAll('link[rel*="icon"]');
    existingFavicons.forEach(favicon => favicon.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = 'data:image/png;base64,${base64}';
    link.setAttribute('x-what-is-this', 'This favicon was inserted by the "My Custom Firefox" extension.');

    document.head.appendChild(link);
  })();`;
}

function matches(matcher, url, isRegex) {
  if (isRegex) {
    try {
      return new RegExp(matcher).test(url);
    } catch {
      return false;
    }
  }

  // Back-compat + safer default:
  // - If matcher looks like a full URL (or includes a path), require exact URL match.
  // - Otherwise treat matcher as a domain and match current host (including subdomains).
  if (matcher.includes("://") || matcher.includes("/")) {
    return url === matcher;
  }

  try {
    const host = new URL(url).hostname.toLowerCase();
    const domain = String(matcher).toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

async function setTabFavicon(tabId, base64Image) {
  await browser.tabs.executeScript(tabId, { code: injectableFavicon(base64Image) });
  return true;
}

async function applyAllMatchers() {
  const storage = await browser.storage.local.get("customFavicons");
  const customFavicons = storage.customFavicons || {};
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    if (!tab.url) continue;

    for (const [matcher, details] of Object.entries(customFavicons)) {
      if (!matches(matcher, tab.url, details.isRegex)) continue;
      try {
        await setTabFavicon(tab.id, details.base64Image);
      } catch {
        // Ignore restricted pages or tabs that disallow injection.
      }
    }
  }
}

function intToBase26(num) {
  if (num === 0) return "a";

  let result = "";
  let n = num;
  while (n > 0) {
    const remainder = n % 26;
    result = String.fromCharCode(97 + remainder) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function hashPrefix(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return intToBase26(Math.abs(hash));
}

async function makeBookmarksUnique() {
  try {
    const bookmarkTree = await browser.bookmarks.getTree();
    const relayBookmarks = [];

    function findRelays(bookmarkNodes) {
      for (const node of bookmarkNodes) {
        if (node.url) {
          try {
            const url = new URL(node.url);
            if (url.hostname === "0xa.click" || url.hostname.endsWith(".0xa.click")) {
              relayBookmarks.push(node);
            }
          } catch {
            // ignore
          }
        }

        if (node.children) findRelays(node.children);
      }
    }

    findRelays(bookmarkTree);
    if (relayBookmarks.length === 0) return;

    for (const bookmark of relayBookmarks) {
      const originalUrl = new URL(bookmark.url);
      const icon = originalUrl.searchParams.get("p");
      if (!icon) continue;

      const subdomain = hashPrefix(icon);
      const newUrl = new URL(bookmark.url);
      newUrl.hostname = `${subdomain}.0xa.click`;

      await browser.bookmarks.update(bookmark.id, { url: newUrl.toString() });
    }
  } catch (error) {
    console.error("Error in makeBookmarksUnique:", error);
  }
}

browser.menus.create(
  {
    id: "tab-name",
    title: "Rename Tab",
    contexts: ["tab"]
  },
  () => {
    if (browser.runtime.lastError) {
      console.warn("Failed to create menu:", browser.runtime.lastError.message);
    }
  }
);

function renameTab(_info, tab) {
  if (!tab || typeof tab.id !== "number") return;

  browser.tabs.update(tab.id, { active: true });
  browser.tabs
    .sendMessage(tab.id, { action: "rename" })
    .then((response) => {
      if (response === undefined) return;

      if (response.title === undefined) {
        tabList.delete(String(tab.id));
        updateMap();
        return;
      }

      tabList.set(String(tab.id), {
        title: response.title,
        default: response.default
      });
      updateMap();
    })
    .catch(() => {
      // No receiver (restricted pages like about:) or tab not ready yet.
    });
}

function updateOnReady(request, sender) {
  if (request?.action !== "ready") return;
  if (!sender?.tab || typeof sender.tab.id !== "number") return;

  const key = String(sender.tab.id);
  if (!tabList.has(key)) return;

  const entry = tabList.get(key);
  entry.default = sender.tab.title;
  updateMap();

  browser.tabs.sendMessage(sender.tab.id, {
    action: "update",
    title: entry.title,
    default: entry.default
  });
}

function closeTab(tabId) {
  const key = String(tabId);
  if (!tabList.has(key)) return;
  tabList.delete(key);
  updateMap();
}

function titleChanged(tabId, changed) {
  if (changed?.title === undefined) return;
  const key = String(tabId);
  if (!tabList.has(key)) return;

  const entry = tabList.get(key);
  if (changed.title === entry.title) return;

  browser.tabs
    .sendMessage(tabId, {
      action: "update",
      title: entry.title,
      default: entry.default
    })
    .catch(() => {
      // Tab hasn't loaded yet or is restricted.
    });
}

function updateMap() {
  if (tabList.size >= 1) {
    browser.storage.local.set({ map: Object.fromEntries(tabList) });
  } else {
    browser.storage.local.remove("map");
  }
}

async function loadMap() {
  const stored = (await browser.storage.local.get()).map;
  tabList = stored ? new Map(Object.entries(stored)) : new Map();
}

async function onReload() {
  await loadMap();
  tabList.forEach((value, key) => {
    const tabId = Number.parseInt(key, 10);
    if (!Number.isFinite(tabId)) return;
    browser.tabs
      .sendMessage(tabId, {
        action: "update",
        title: value.title,
        default: value.default
      })
      .catch(() => {});
  });
}

browser.menus.onClicked.addListener(renameTab);
browser.runtime.onMessage.addListener(updateOnReady);
browser.runtime.onInstalled.addListener(onReload);
browser.runtime.onStartup.addListener(onReload);
browser.tabs.onRemoved.addListener(closeTab);
browser.tabs.onUpdated.addListener(titleChanged);

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.action === "newRule") {
    applyAllMatchers();
    makeBookmarksUnique();
  } else if (message?.action === "makeUnique") {
    makeBookmarksUnique();
  }
});

browser.tabs.onUpdated.addListener(applyAllMatchers);
browser.tabs.onCreated.addListener(applyAllMatchers);
browser.tabs.onActivated.addListener(applyAllMatchers);
browser.runtime.onStartup.addListener(makeBookmarksUnique);

browser.browserAction.onClicked.addListener(openFaviconManager);
