let defaultTitle = document.title;
let customTitle;

function applyTitle() {
  document.title = customTitle ?? defaultTitle;
}

browser.runtime.sendMessage({ action: "ready" });

browser.runtime.onMessage.addListener((message) => {
  switch (message?.action) {
    case "rename":
      return renameTab();
    case "update":
      updateTab(message);
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

