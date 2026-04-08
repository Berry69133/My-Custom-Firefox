const titleEl = document.getElementById("title");
const messageEl = document.getElementById("message");
const frameEl = document.getElementById("frame");

let currentUrl = "";
let currentRequestId = 0;

function safeParseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function canEmbedInSidebar(url) {
  const parsed = safeParseUrl(url);
  if (!parsed) return false;
  return ["http:", "https:", "file:"].includes(parsed.protocol);
}

function setMessage(text) {
  messageEl.textContent = text;
  messageEl.style.display = "flex";
  frameEl.style.display = "none";
  frameEl.removeAttribute("src");
}

function setFrame(url) {
  const requestId = ++currentRequestId;
  messageEl.style.display = "none";
  frameEl.style.display = "block";
  frameEl.src = url;

  const checkForEmbedBlock = () => {
    if (requestId !== currentRequestId) return;

    let href;
    try {
      href = frameEl?.contentWindow?.location?.href;
    } catch {
      return;
    }

    if (typeof href !== "string" || href.trim() === "") return;
    const normalized = href.trim();

    if (normalized === "about:blank" || normalized.startsWith("about:neterror") || normalized.startsWith("about:blocked")) {
      setMessage("This site blocks being shown in the sidebar.");
    }
  };

  // Some embed blocks render as an about:* page inside the frame.
  setTimeout(checkForEmbedBlock, 800);
  setTimeout(checkForEmbedBlock, 1800);
}

function setTitle(text) {
  titleEl.textContent = text || "Sidebar";
}

async function applyTarget(target) {
  const url = typeof target?.url === "string" ? target.url : "";
  const title = typeof target?.title === "string" ? target.title : "";

  setTitle(title || url || "Sidebar");
  currentUrl = url;

  if (!url) {
    setMessage("Right-click a tab → “Open in Side Bar”.");
    return;
  }

  if (!canEmbedInSidebar(url)) {
    setMessage("This tab URL can’t be shown in the sidebar.");
    return;
  }

  setFrame(url);
}
browser.runtime.onMessage.addListener((message) => {
  if (message?.action !== "sidebarSetTarget") return;
  applyTarget(message);
});

(async () => {
  try {
    const stored = await browser.storage.local.get("sidebarTarget");
    await applyTarget(stored?.sidebarTarget);
  } catch {
    setMessage("Right-click a tab → “Open in Side Bar”.");
  }
})();
