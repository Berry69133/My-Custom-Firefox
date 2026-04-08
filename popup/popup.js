let base64Image = null;
let currentTabId = null;
let currentTabUrl = null;
let currentTabTitle = null;

const DEFAULT_FAVICON_SIZE = 32;

const body = document.body;
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const localFaviconBtn = document.getElementById("localFaviconBtn");
const previewImg = document.getElementById("preview");
const announceBar = document.getElementById("announce");
const urlPatternInput = document.getElementById("urlPattern");
const useRegexCheckbox = document.getElementById("useRegex");
const customFaviconsList = document.getElementById("customFaviconsList");
const singletonDomainsTextarea = document.getElementById("singletonDomains");
const saveSingletonDomainsBtn = document.getElementById("saveSingletonDomainsBtn");
const singletonRegexInput = document.getElementById("singletonRegex");
const saveSingletonRegexBtn = document.getElementById("saveSingletonRegexBtn");

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

function normalizeUrlForExactMatch(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function normalizeUserUrlInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Accept a few common "missing slashes" typos:
  // - http/test/ciao -> http://test/ciao
  // - http:/test/ciao -> http://test/ciao
  // - http//test/ciao -> http://test/ciao
  if (/^https?\/(?!\/)/i.test(trimmed)) {
    return trimmed.replace(/^(https?)\//i, "$1://");
  }
  if (/^https?:\/(?!\/)/i.test(trimmed)) {
    return trimmed.replace(/^(https?):\//i, "$1://");
  }
  if (/^https?\/\/(?!\/)/i.test(trimmed)) {
    return trimmed.replace(/^(https?)\/\//i, "$1://");
  }

  return trimmed;
}

function parseNonRegexMatcher(value) {
  const raw = normalizeUserUrlInput(value);
  if (!raw) return null;

  // If user pasted a full URL, store an exact URL matcher.
  if (raw.includes("://")) {
    const normalized = normalizeUrlForExactMatch(raw);
    if (!normalized) return null;
    return { matchType: "url", matcher: normalized };
  }

  // Otherwise treat as a domain (strip any accidental path/query).
  const withoutPath = raw.split(/[/?#]/, 1)[0];
  if (!withoutPath) return null;

  try {
    // Use URL parsing to robustly extract hostname (and strip ports if present).
    const parsed = new URL(`http://${withoutPath}`);
    if (!parsed.hostname) return null;
    return { matchType: "domain", matcher: parsed.hostname.toLowerCase() };
  } catch {
    return null;
  }
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
    setPreviewFromImage(img, DEFAULT_FAVICON_SIZE);
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

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tabContents.forEach((c) => c.classList.remove("active"));

    tab.classList.add("active");
    const tabName = tab.getAttribute("data-tab");
    document.getElementById(`${tabName}Tab`).classList.add("active");

    if (tabName === "favicons") loadCustomFaviconsList();
    if (tabName === "singletons") loadSingletonSettings();
  });
});

function normalizeDomainInput(value) {
  const raw = normalizeUserUrlInput(value);
  if (!raw) return null;

  if (raw.includes("://")) {
    try {
      const parsed = new URL(raw);
      return parsed.hostname ? parsed.hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  const withoutPath = raw.split(/[/?#]/, 1)[0];
  if (!withoutPath) return null;

  try {
    const parsed = new URL(`http://${withoutPath}`);
    return parsed.hostname ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function parseSingletonDomains(text) {
  const parts = String(text)
    .split(/[\n,]/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const normalized = [];
  for (const part of parts) {
    const domain = normalizeDomainInput(part);
    if (!domain) continue;
    normalized.push(domain);
  }

  return Array.from(new Set(normalized)).sort();
}

async function loadSingletonDomains() {
  try {
    const storage = await browser.storage.local.get("singletonDomains");
    const list = Array.isArray(storage.singletonDomains) ? storage.singletonDomains : [];
    singletonDomainsTextarea.value = list.join("\n");
  } catch (error) {
    console.error("Error loading singleton domains:", error);
    singletonDomainsTextarea.value = "";
  }
}

async function loadSingletonSettings() {
  await loadSingletonDomains();

  try {
    const storage = await browser.storage.local.get("singletonRegex");
    const pattern = typeof storage.singletonRegex === "string" ? storage.singletonRegex : "";
    singletonRegexInput.value = pattern;
  } catch (error) {
    console.error("Error loading singleton regex:", error);
    singletonRegexInput.value = "";
  }
}

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
      const effectiveType = faviconData.isRegex ? "regex" : (faviconData.matchType ?? (pattern.includes("://") ? "url-prefix" : "domain"));
      url.textContent = `${pattern} (${effectiveType})`;

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

  // Preload for cases where the user lands directly on the Single-tab tab later.
  loadSingletonSettings();
  loadCustomFaviconsList();
});

localFaviconBtn.addEventListener("click", async () => {
  if (!base64Image) return announce("Upload an image first.", "red", "white");

  const input = urlPatternInput.value.trim();
  if (!input) return announce("Enter a domain, URL, or pattern.", "red", "white");

  const isRegex = useRegexCheckbox.checked;
  let urlPattern = input;
  let matchType = undefined;

  if (!isRegex) {
    const parsed = parseNonRegexMatcher(input);
    if (!parsed) return announce("Invalid domain/URL.", "red", "white");
    urlPattern = parsed.matcher;
    matchType = parsed.matchType;
  }

  try {
    const faviconData = {
      base64Image,
      size: DEFAULT_FAVICON_SIZE,
      isRegex,
      matchType
    };

    const storage = await browser.storage.local.get("customFavicons");
    const customFavicons = storage.customFavicons || {};
    customFavicons[urlPattern] = faviconData;
    await browser.storage.local.set({ customFavicons });
    await browser.runtime.sendMessage({ action: "newRule" });
    loadCustomFaviconsList();

    announce("Local favicon rule saved", "green", "white");
  } catch (error) {
    console.error(error);
    announce("Failed to save rule", "red", "white");
  }
});

saveSingletonDomainsBtn.addEventListener("click", async () => {
  const list = parseSingletonDomains(singletonDomainsTextarea.value);

  try {
    await browser.storage.local.set({ singletonDomains: list });
    announce("Single-tab domains saved", "green", "white");
  } catch (error) {
    console.error(error);
    announce("Failed to save single-tab domains", "red", "white");
  }
});

saveSingletonRegexBtn.addEventListener("click", async () => {
  const raw = String(singletonRegexInput.value ?? "").trim();

  if (raw) {
    try {
      // Validate now so we can give immediate feedback.
      new RegExp(raw);
    } catch {
      return announce("Invalid regex pattern", "red", "white");
    }
  }

  try {
    if (!raw) {
      await browser.storage.local.remove("singletonRegex");
      announce("Single-tab regex cleared", "green", "white");
      return;
    }

    await browser.storage.local.set({ singletonRegex: raw });
    announce("Single-tab regex saved", "green", "white");
  } catch (error) {
    console.error(error);
    announce("Failed to save single-tab regex", "red", "white");
  }
});
