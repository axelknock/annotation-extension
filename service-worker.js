const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com/"
];

function isRestrictedUrl(url = "") {
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function toggleOnTab(tab) {
  if (!tab?.id) return;
  if (isRestrictedUrl(tab.url || "")) {
    console.warn("Browser Annotations cannot run on this page.");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "BC_TOGGLE" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
    } catch (error) {
      console.warn("Browser Annotations cannot run on this page.", error);
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  toggleOnTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BC_CAPTURE") {
    const windowId = sender.tab?.windowId;
    chrome.tabs
      .captureVisibleTab(windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "BC_STATUS") {
    const tabId = sender.tab?.id;
    if (tabId == null) return;

    const text = message.active && message.count > 0 ? String(message.count) : "";
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563EB" });
    chrome.action.setBadgeTextColor?.({ tabId, color: "#FFFFFF" });
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setTitle({
      tabId,
      title: message.active ? "Stop annotating" : "Annotate this page"
    });
  }
});
