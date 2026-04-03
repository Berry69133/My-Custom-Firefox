browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "hello") return;
  return Promise.resolve({
    text: "Hello from the background script!"
  });
});

console.log("Hello World extension loaded.");

let tabList = new Map();
let singletonDomains = [];
const singletonRedirectingTabs = new Set();

async function loadSingletonDomains() {
  const stored = await browser.storage.local.get("singletonDomains");
  singletonDomains = Array.isArray(stored.singletonDomains) ? stored.singletonDomains : [];
}

function matchSingletonDomain(url) {
  if (!Array.isArray(singletonDomains) || singletonDomains.length === 0) return null;

  let hostname = null;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (!hostname) return null;

  for (const entry of singletonDomains) {
    const domain = String(entry || "").toLowerCase().trim();
    if (!domain) continue;
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return domain;
  }

  return null;
}

function markSingletonRedirecting(tabId) {
  singletonRedirectingTabs.add(tabId);
  setTimeout(() => singletonRedirectingTabs.delete(tabId), 2000);
}

loadSingletonDomains().catch(() => {});

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

function normalizeUrlForExactMatch(url) {
  try {
    const parsed = new URL(url);
    // Ignore the fragment so a rule can match the "same page" regardless of #hash.
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function matches(matcher, url, isRegex, matchType) {
  if (isRegex) {
    try {
      return new RegExp(matcher).test(url);
    } catch {
      return false;
    }
  }

  // Back-compat: older rules only stored `isRegex`.
  const resolvedType = matchType ?? (matcher.includes("://") ? "url" : "domain");

  if (resolvedType === "url") {
    const normalizedUrl = normalizeUrlForExactMatch(url);
    const normalizedMatcher = normalizeUrlForExactMatch(matcher);
    if (!normalizedUrl || !normalizedMatcher) return false;
    // "url" rules are prefix-based (the common "http://site/path*" behavior).
    return normalizedUrl.startsWith(normalizedMatcher);
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
      if (!matches(matcher, tab.url, details.isRegex, details.matchType)) continue;
      try {
        await setTabFavicon(tab.id, details.base64Image);
      } catch {
        // Ignore restricted pages or tabs that disallow injection.
      }
    }
  }
}

// (bookmark-favicon feature removed)

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
  await loadSingletonDomains();
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

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes?.singletonDomains) return;
  const next = changes.singletonDomains.newValue;
  singletonDomains = Array.isArray(next) ? next : [];
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.action === "newRule") {
    applyAllMatchers();
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo?.url) return;
  if (!tab || typeof tab.windowId !== "number") return;
  if (singletonRedirectingTabs.has(tabId)) return;

  const matchedDomain = matchSingletonDomain(changeInfo.url);
  if (!matchedDomain) return;

  const tabs = await browser.tabs.query({ windowId: tab.windowId });
  const existing = tabs.find((t) => {
    if (!t?.url || typeof t.id !== "number") return false;
    if (t.id === tabId) return false;
    return matchSingletonDomain(t.url) === matchedDomain;
  });

  if (!existing || typeof existing.id !== "number") return;

  try {
    markSingletonRedirecting(existing.id);
    markSingletonRedirecting(tabId);
    await browser.windows.update(tab.windowId, { focused: true });
    await browser.tabs.update(existing.id, { url: changeInfo.url, active: true });
    await browser.tabs.remove(tabId);
  } catch {
    // Ignore races (tab closed, restricted URL, etc).
  }
});

browser.tabs.onUpdated.addListener(applyAllMatchers);
browser.tabs.onCreated.addListener(applyAllMatchers);
browser.tabs.onActivated.addListener(applyAllMatchers);

browser.browserAction.onClicked.addListener(openFaviconManager);
