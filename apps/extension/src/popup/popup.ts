const groupsContainer = document.getElementById("groups")!;
const statusElement = document.getElementById("status")!;
const refreshButton = document.getElementById("refresh")!;

function setIndicator(dotId: string, textId: string, text: string, state: string) {
  const dot = document.getElementById(dotId);
  const label = document.getElementById(textId);
  if (dot) dot.className = `status-dot ${state}`;
  if (label) label.textContent = text;
}

async function loadConnectionStatus() {
  const result = await chrome.storage.local.get([
    "webAppLastSeenAt",
    "groupsSyncStatus",
    "groupsSyncCount",
  ]);
  const webAppOnline = typeof result.webAppLastSeenAt === "number" &&
    Date.now() - result.webAppLastSeenAt < 90_000;
  setIndicator("web-app-dot", "web-app-status", webAppOnline ? "Connected" : "Offline", webAppOnline ? "online" : "offline");

  const syncStatus = result.groupsSyncStatus as string | undefined;
  if (syncStatus === "synced") {
    setIndicator("sync-dot", "sync-status", `Synced (${result.groupsSyncCount ?? 0})`, "synced");
  } else if (syncStatus === "syncing") {
    setIndicator("sync-dot", "sync-status", "Syncing...", "not-synced");
  } else {
    setIndicator("sync-dot", "sync-status", "Not synced", "not-synced");
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function checkFacebook() {
  const tab = await getActiveTab();

  const isFacebook = tab.url?.startsWith("https://www.facebook.com");

  statusElement.textContent = isFacebook ? "Facebook detected" : "Open Facebook";
}

async function loadGroups() {
  const result = await chrome.storage.local.get("facebookGroups");
  const groups = (result.facebookGroups ?? []) as FacebookGroup[];
  renderGroups(groups);
}

function renderGroups(groups: FacebookGroup[]) {
  const countEl = document.getElementById("group-count");
  if (countEl) countEl.textContent = String(groups.length);
  
  groupsContainer.innerHTML = "";

  if (groups.length === 0) {
    groupsContainer.innerHTML = `
      <p class="empty">
        No groups detected.
      </p>
    `;
    return;
  }

  for (const group of groups) {
    const row = document.createElement("article");
    row.className = "group";

    const icon = document.createElement("div");
    icon.className = "group-icon";
    icon.textContent = initialsFor(group.name);

    const content = document.createElement("div");

    const name = document.createElement("span");
    name.textContent = group.name;

    const meta = document.createElement("small");
    meta.textContent = group.url.replace(/^https?:\/\/(www\.)?/, "");

    content.appendChild(name);
    content.appendChild(meta);
    row.appendChild(icon);
    row.appendChild(content);

    groupsContainer.appendChild(row);
  }
}

function initialsFor(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]).join("");
  return initials.toUpperCase() || "G";
}

refreshButton.addEventListener("click", () => {
  const originalText = refreshButton.textContent;
  refreshButton.textContent = "Scanning...";
  refreshButton.setAttribute("disabled", "true");
  chrome.runtime.sendMessage({ type: "TRIGGER_GROUP_SYNC" });
  setTimeout(loadConnectionStatus, 250);
  
  // Reload storage after giving content script time to run active fetch
  setTimeout(() => {
    loadGroups();
    refreshButton.textContent = originalText;
    refreshButton.removeAttribute("disabled");
  }, 2000);
});

checkFacebook();
loadGroups();
loadConnectionStatus();
