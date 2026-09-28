const statusElement = document.getElementById("status")!;
const refreshButton = document.getElementById("refresh")!;
const openDashboardButton = document.getElementById("open-dashboard")!;
const openFacebookGroupsButton = document.getElementById("open-facebook-groups")!;
const extensionNameInput = document.getElementById("extension-name") as HTMLInputElement;
const profileNameElement = document.getElementById("profile-name")!;
const editNameButton = document.getElementById("edit-name")!;
const cancelNameButton = document.getElementById("cancel-name")!;
const nameEditor = document.getElementById("name-editor")!;
const saveNameButton = document.getElementById("save-name")!;
const nameStatus = document.getElementById("name-status")!;
const detectedCountElement = document.getElementById("detected-count")!;
const syncedCountElement = document.getElementById("synced-count")!;
const notSyncedCountElement = document.getElementById("not-synced-count")!;
const groupsSummaryElement = document.getElementById("groups-summary")!;

let currentExtensionName = "";

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
    "groupsLastSyncedAt",
    "facebookIdentityVerified",
    "facebookConnectionStatus",
  ]);
  const facebookStatus = typeof result.facebookConnectionStatus === "string"
    ? result.facebookConnectionStatus
    : "UNKNOWN";
  const identityVerified = result.facebookIdentityVerified === true;
  statusElement.textContent = identityVerified ? "Ready" : statusLabelForFacebook(facebookStatus);
  statusElement.className = `page-status ${identityVerified ? "ready" : "attention"}`;

  const webAppOnline = typeof result.webAppLastSeenAt === "number" &&
    Date.now() - result.webAppLastSeenAt < 90_000;
  setIndicator("web-app-dot", "web-app-status", webAppOnline ? "Connected" : "Offline", webAppOnline ? "online" : "offline");

  const syncStatus = result.groupsSyncStatus as string | undefined;
  if (syncStatus === "synced") {
    setIndicator("sync-dot", "sync-status", `Synced (${result.groupsSyncCount ?? 0})`, "synced");
  } else if (syncStatus === "syncing") {
    setIndicator("sync-dot", "sync-status", "Syncing...", "not-synced");
  } else if (syncStatus === "identity-required") {
    setIndicator("sync-dot", "sync-status", "Login needed", "offline");
  } else if (syncStatus === "error") {
    setIndicator("sync-dot", "sync-status", "Sync failed", "offline");
  } else {
    setIndicator("sync-dot", "sync-status", "Not synced", "not-synced");
  }

  const lastSyncedAt = typeof result.groupsLastSyncedAt === "number"
    ? result.groupsLastSyncedAt
    : undefined;
  const lastSyncLabel = document.getElementById("last-sync-status");
  if (lastSyncLabel) lastSyncLabel.textContent = lastSyncedAt ? timeAgo(lastSyncedAt) : "Never";
}

function statusLabelForFacebook(status: string): string {
  if (status === "LOGIN_REQUIRED") return "Login needed";
  if (status === "ACCOUNT_MISMATCH") return "Wrong account";
  if (status === "BLOCKED") return "Blocked";
  return "Not ready";
}

function timeAgo(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function loadExtensionName() {
  const result = await chrome.storage.local.get(["extensionName", "extensionInstanceId"]);
  currentExtensionName = typeof result.extensionName === "string" ? result.extensionName.trim() : "";
  extensionNameInput.value = currentExtensionName;
  const instanceId = typeof result.extensionInstanceId === "string" ? result.extensionInstanceId.trim() : "";
  profileNameElement.textContent = currentExtensionName || shortInstanceName(instanceId);
}

function shortInstanceName(instanceId: string): string {
  if (!instanceId) return "Profile pending";
  const shortId = instanceId.replace(/^pfi_/, "").slice(0, 8);
  return `Profile ${shortId}`;
}

function setNameEditorOpen(open: boolean) {
  nameEditor.toggleAttribute("hidden", !open);
  editNameButton.toggleAttribute("hidden", open);
  if (open) {
    extensionNameInput.focus();
    extensionNameInput.select();
  }
}

async function loadGroups() {
  const result = await chrome.storage.local.get([
    "facebookGroups",
    "groupsSyncStatus",
    "groupsSyncCount",
    "facebookIdentityVerified",
    "facebookConnectionStatus",
  ]);
  const groups = (result.facebookGroups ?? []) as FacebookGroup[];
  renderGroupSummary(
    groups.length,
    result.groupsSyncStatus as string | undefined,
    typeof result.groupsSyncCount === "number" ? result.groupsSyncCount : 0,
    result.facebookIdentityVerified === true,
    typeof result.facebookConnectionStatus === "string" ? result.facebookConnectionStatus : "UNKNOWN",
  );
}

function renderGroupSummary(
  detectedCount: number,
  syncStatus: string | undefined,
  syncedCount: number,
  identityVerified: boolean,
  facebookStatus: string,
) {
  const countEl = document.getElementById("group-count");
  const effectiveSyncedCount = syncStatus === "synced"
    ? Math.min(syncedCount, detectedCount)
    : 0;
  const notSyncedCount = Math.max(0, detectedCount - effectiveSyncedCount);

  if (countEl) countEl.textContent = String(detectedCount);
  detectedCountElement.textContent = String(detectedCount);
  syncedCountElement.textContent = String(effectiveSyncedCount);
  notSyncedCountElement.textContent = String(notSyncedCount);

  if (!identityVerified) {
    groupsSummaryElement.textContent = statusLabelForFacebook(facebookStatus);
  } else if (detectedCount === 0) {
    groupsSummaryElement.textContent = "Open Facebook and refresh.";
  } else if (syncStatus === "syncing") {
    groupsSummaryElement.textContent = `${detectedCount} detected. Syncing.`;
  } else if (syncStatus === "error") {
    groupsSummaryElement.textContent = "Sync failed. Try refresh.";
  } else if (notSyncedCount === 0) {
    groupsSummaryElement.textContent = `All ${detectedCount} synced.`;
  } else {
    groupsSummaryElement.textContent = `${notSyncedCount} of ${detectedCount} not synced.`;
  }
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

openDashboardButton.addEventListener("click", async () => {
  const existingTabs = await chrome.tabs.query({
    url: [
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
      "https://fitcure.online/*",
    ],
  });
  const existingTab = existingTabs.find((tab) => tab.id !== undefined);
  if (existingTab?.id !== undefined) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId !== undefined) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  const result = await chrome.storage.local.get(["webAppLastDashboardUrl", "webAppLastUrl"]);
  const dashboardUrl = typeof result.webAppLastDashboardUrl === "string" && result.webAppLastDashboardUrl.trim()
    ? result.webAppLastDashboardUrl.trim()
    : typeof result.webAppLastUrl === "string" && result.webAppLastUrl.trim()
      ? result.webAppLastUrl.trim()
      : "http://localhost:3000";
  await chrome.tabs.create({ url: dashboardUrl });
});

openFacebookGroupsButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://www.facebook.com/groups/joins/?nav_source=tab" });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const relevantKeys = new Set([
    "facebookGroups",
    "groupsSyncStatus",
    "groupsSyncCount",
    "groupsLastSyncedAt",
    "webAppLastSeenAt",
    "facebookIdentityVerified",
    "facebookConnectionStatus",
  ]);
  if (!Object.keys(changes).some((key) => relevantKeys.has(key))) return;
  void loadConnectionStatus();
  void loadGroups();
});

editNameButton.addEventListener("click", () => {
  nameStatus.textContent = "";
  setNameEditorOpen(true);
});

cancelNameButton.addEventListener("click", () => {
  extensionNameInput.value = currentExtensionName;
  nameStatus.textContent = "";
  setNameEditorOpen(false);
});

saveNameButton.addEventListener("click", async () => {
  const extensionName = extensionNameInput.value.trim();
  saveNameButton.setAttribute("disabled", "true");
  nameStatus.textContent = "Saving...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "SAVE_EXTENSION_NAME", extensionName });
    if (result?.ok) {
      currentExtensionName = extensionName;
      await loadExtensionName();
      nameStatus.textContent = extensionName ? "Saved" : "Name cleared";
      setNameEditorOpen(false);
    } else {
      nameStatus.textContent = result?.error ?? "Could not save";
    }
  } catch {
    nameStatus.textContent = "Could not save";
  } finally {
    saveNameButton.removeAttribute("disabled");
  }
});

loadGroups();
loadConnectionStatus();
loadExtensionName();
