let defaultTitle = document.title;
let customTitle;
let splitViewPinnedMode = false;
let splitViewLinkInterceptorInstalled = false;

function applyTitle() {
  document.title = customTitle ?? defaultTitle;
}

browser.runtime.sendMessage({ action: "ready" });
refreshSplitViewPinnedMode();

browser.runtime.onMessage.addListener((message) => {
  switch (message?.action) {
    case "rename":
      return renameTab();
    case "update":
      updateTab(message);
      break;
    case "splitViewMode":
      setSplitViewPinnedMode(Boolean(message.enabled));
      break;
  }
});

function renameTab() {
  const newName = prompt("Rename this tab (leave blank to reset)", document.title);
  if (newName === null) return;

  if (newName.trim() === "") {
    customTitle = undefined;
    applyTitle();
    return Promise.resolve({
      title: customTitle,
      default: defaultTitle
    });
  }

  customTitle = newName;
  applyTitle();
  return Promise.resolve({
    title: customTitle,
    default: defaultTitle
  });
}

function updateTab(message) {
  defaultTitle = message.default;
  customTitle = message.title;
  applyTitle();
}

function setSplitViewPinnedMode(enabled) {
  if (enabled === splitViewPinnedMode) return;
  splitViewPinnedMode = enabled;

  if (splitViewPinnedMode) {
    installSplitViewLinkInterceptor();
  } else {
    uninstallSplitViewLinkInterceptor();
  }
}

async function refreshSplitViewPinnedMode() {
  try {
    const response = await browser.runtime.sendMessage({ action: "getSplitViewStatus" });
    setSplitViewPinnedMode(Boolean(response?.isSplitView));
  } catch {
    // Ignore (extension restarting, restricted page, etc.).
  }
}

function installSplitViewLinkInterceptor() {
  if (splitViewLinkInterceptorInstalled) return;
  splitViewLinkInterceptorInstalled = true;
  document.addEventListener("click", onSplitViewDocumentClick, true);
}

function uninstallSplitViewLinkInterceptor() {
  if (!splitViewLinkInterceptorInstalled) return;
  splitViewLinkInterceptorInstalled = false;
  document.removeEventListener("click", onSplitViewDocumentClick, true);
}

function onSplitViewDocumentClick(event) {
  if (!splitViewPinnedMode) return;
  if (event.defaultPrevented) return;
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const anchor = findAnchorInEvent(event);
  if (!anchor) return;

  if (anchor.hasAttribute("download")) return;

  const targetAttr = anchor.getAttribute("target");
  if (targetAttr && targetAttr.trim() !== "" && targetAttr.toLowerCase() !== "_self") return;

  const hrefAttr = anchor.getAttribute("href");
  if (!hrefAttr) return;
  if (hrefAttr.trim() === "" || hrefAttr.trim() === "#") return;
  if (hrefAttr.trim().toLowerCase().startsWith("javascript:")) return;

  const destination = safeUrl(hrefAttr);
  if (!destination) return;

  if (isSameDocumentHashOnlyNavigation(destination)) return;
  if (!["http:", "https:", "file:"].includes(destination.protocol)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  browser.runtime.sendMessage({ action: "openInNewTab", url: destination.href }).catch(() => {});
}

function findAnchorInEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : null;
  if (Array.isArray(path)) {
    for (const item of path) {
      if (item instanceof HTMLAnchorElement) return item;
    }
  }

  const target = event.target;
  if (target instanceof Element) return target.closest("a[href]");
  return null;
}

function safeUrl(href) {
  try {
    return new URL(href, document.baseURI);
  } catch {
    return null;
  }
}

function isSameDocumentHashOnlyNavigation(destination) {
  try {
    const current = new URL(window.location.href);
    const currentNoHash = `${current.origin}${current.pathname}${current.search}`;
    const destNoHash = `${destination.origin}${destination.pathname}${destination.search}`;
    return currentNoHash === destNoHash && current.hash !== destination.hash;
  } catch {
    return false;
  }
}
