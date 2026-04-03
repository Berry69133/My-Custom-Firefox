let base64Image = null;
let currentTabId = null;
let currentTabUrl = null;
let currentTabTitle = null;

const body = document.body;
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sizeSelect = document.getElementById("size");
const bookmarkBtn = document.getElementById("bookmarkBtn");
const localFaviconBtn = document.getElementById("localFaviconBtn");
const titleInput = document.getElementById("title");
const previewImg = document.getElementById("preview");
const announceBar = document.getElementById("announce");
const urlPatternInput = document.getElementById("urlPattern");
const useRegexCheckbox = document.getElementById("useRegex");
const customFaviconsList = document.getElementById("customFaviconsList");

const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");

function announce(text, bgColor, textColor) {
  announceBar.innerText = text;
  announceBar.style.backgroundColor = bgColor;
  announceBar.style.color = textColor;

  setTimeout(() => {
    announceBar.innerText = "";
    announceBar.style.backgroundColor = "";
    announceBar.style.color = "";
  }, 3500);
}

function hostnameFromInput(value) {
  const raw = value.trim();
  if (!raw) return null;

  // If user pasted a URL, extract hostname.
  if (raw.includes("://")) {
    try {
      return new URL(raw).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  // If user typed a domain, accept it (strip any accidental path/query).
  const withoutPath = raw.split(/[/?#]/, 1)[0];
  if (!withoutPath) return null;
  return withoutPath.toLowerCase();
}

async function getCurrentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function setPreviewFromImage(img, size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, size, size);
  const dataUrl = canvas.toDataURL("image/png");

  base64Image = dataUrl.split(",")[1];
  previewImg.src = dataUrl;
}

function processFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    announce("Please upload an image.", "red", "white");
    return;
  }

  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = () => {
    setPreviewFromImage(img, Number.parseInt(sizeSelect.value, 10));
  };
}

body.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});

body.addEventListener("dragleave", () => {
  dropzone.classList.remove("drag");
});

body.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  const file = e.dataTransfer.files[0];
  processFile(file);
});

dropzone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  processFile(file);
});

sizeSelect.addEventListener("change", () => {
  if (!previewImg.src) return;
  const img = new Image();
  img.src = previewImg.src;
  img.onload = () => {
    setPreviewFromImage(img, Number.parseInt(sizeSelect.value, 10));
  };
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tabContents.forEach((c) => c.classList.remove("active"));

    tab.classList.add("active");
    const tabName = tab.getAttribute("data-tab");
    document.getElementById(`${tabName}Tab`).classList.add("active");

    if (tabName === "manage") loadCustomFaviconsList();
  });
});

async function loadCustomFaviconsList() {
  try {
    const storage = await browser.storage.local.get("customFavicons");
    const customFavicons = storage.customFavicons || {};

    customFaviconsList.innerText = "";
    if (Object.keys(customFavicons).length === 0) {
      customFaviconsList.innerText = "No custom favicons set";
      return;
    }

    for (const [pattern, faviconData] of Object.entries(customFavicons)) {
      const item = document.createElement("div");
      item.className = "favicon-item";

      const img = document.createElement("img");
      img.src = `data:image/png;base64,${faviconData.base64Image}`;

      const url = document.createElement("span");
      url.className = "url";
      url.textContent = pattern;

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        delete customFavicons[pattern];
        await browser.storage.local.set({ customFavicons });
        loadCustomFaviconsList();
        announce("Favicon rule removed", "green", "white");
        await browser.runtime.sendMessage({ action: "newRule" });
      });

      item.appendChild(img);
      item.appendChild(url);
      item.appendChild(removeBtn);

      customFaviconsList.appendChild(item);
    }
  } catch (error) {
    console.error("Error loading custom favicons list:", error);
    customFaviconsList.innerText = "Error loading custom favicons";
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const paramTabId = params.get("tabId");
  const paramUrl = params.get("tabUrl");
  const paramTitle = params.get("tabTitle");

  if (paramTabId) {
    const parsed = Number.parseInt(paramTabId, 10);
    if (Number.isFinite(parsed)) currentTabId = parsed;
  }

  if (paramUrl) currentTabUrl = paramUrl;
  if (paramTitle) currentTabTitle = paramTitle;

  // If we know the originating tab id, prefer reading from that tab (so we never
  // accidentally use the moz-extension:// window URL).
  if (currentTabId !== null) {
    try {
      const tab = await browser.tabs.get(currentTabId);
      currentTabUrl = tab?.url ?? currentTabUrl;
      currentTabTitle = tab?.title ?? currentTabTitle;
    } catch {
      // Tab might have been closed; keep query-string values.
    }
  } else if (!currentTabUrl || !currentTabTitle) {
    // Fallback for cases where popup is used as a browser_action popup.
    const tab = await getCurrentTab();
    currentTabUrl = currentTabUrl ?? tab?.url ?? null;
    currentTabTitle = currentTabTitle ?? tab?.title ?? null;
  }

  if (currentTabUrl) {
    try {
      urlPatternInput.value = new URL(currentTabUrl).hostname;
    } catch {
      urlPatternInput.value = currentTabUrl;
    }
  }
});

localFaviconBtn.addEventListener("click", async () => {
  if (!base64Image) return announce("Upload an image first.", "red", "white");

  let urlPattern = urlPatternInput.value.trim();
  if (!urlPattern) return announce("Enter a domain or pattern.", "red", "white");

  if (!useRegexCheckbox.checked) {
    const hostname = hostnameFromInput(urlPattern);
    if (!hostname) return announce("Invalid domain/URL.", "red", "white");
    urlPattern = hostname;
  }

  try {
    const faviconData = {
      base64Image,
      size: Number.parseInt(sizeSelect.value, 10),
      isRegex: useRegexCheckbox.checked
    };

    const storage = await browser.storage.local.get("customFavicons");
    const customFavicons = storage.customFavicons || {};
    customFavicons[urlPattern] = faviconData;
    await browser.storage.local.set({ customFavicons });
    await browser.runtime.sendMessage({ action: "newRule" });

    announce("Local favicon rule saved", "green", "white");
  } catch (error) {
    console.error(error);
    announce("Failed to save rule", "red", "white");
  }
});

bookmarkBtn.addEventListener("click", async () => {
  if (!base64Image) return announce("Upload an image first.", "red", "white");
  if (useRegexCheckbox.checked) return announce("Disable regex to create a bookmark", "red", "white");

  let url = currentTabUrl;
  let titleFallback = currentTabTitle ?? currentTabUrl ?? "Custom Bookmark";

  if (currentTabId !== null) {
    try {
      const tab = await browser.tabs.get(currentTabId);
      url = tab?.url ?? url;
      titleFallback = tab?.title ?? titleFallback;
    } catch {
      // Keep last-known URL/title.
    }
  }

  if (!url) return announce("No active tab URL found.", "red", "white");
  if (url.startsWith("moz-extension://")) {
    return announce("Couldn't find the original tab URL. Close and re-open the window from the toolbar button.", "red", "white");
  }

  const customUrl = `https://0xa.click/?p=${encodeURIComponent(base64Image)}&u=${encodeURIComponent(url)}`;
  const bookmarkTitle = titleInput.value.trim() || titleFallback;

  try {
    await browser.bookmarks.create({
      title: bookmarkTitle,
      url: customUrl,
      parentId: "toolbar_____"
    });
    await browser.runtime.sendMessage({ action: "makeUnique" });
    announce("Bookmark created", "green", "white");

    titleInput.value = "";
  } catch (error) {
    console.error(error);
    announce("Failed to create bookmark", "red", "white");
  }
});
