import {
  reconnectNeedsConfirmation,
  recoveryCandidateLabel,
  type RecoveryCandidate,
} from "../extension-recovery.js";

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
const dashboardTab = document.getElementById("dashboard-tab") as HTMLButtonElement;
const phoneCollectorTab = document.getElementById("phone-collector-tab") as HTMLButtonElement;
const dashboardView = document.getElementById("dashboard-view")!;
const phoneCollectorView = document.getElementById("phone-collector-view")!;
const collectorPageTitle = document.getElementById("collector-page-title")!;
const collectorPageUrl = document.getElementById("collector-page-url")!;
const collectNumbersButton = document.getElementById("collect-numbers") as HTMLButtonElement;
const collectorStatus = document.getElementById("collector-status")!;
const phoneFoundCount = document.getElementById("phone-found-count")!;
const phoneValidCount = document.getElementById("phone-valid-count")!;
const phoneDuplicateCount = document.getElementById("phone-duplicate-count")!;
const phoneInvalidCount = document.getElementById("phone-invalid-count")!;
const selectedPhoneCount = document.getElementById("selected-phone-count")!;
const selectAllPhonesButton = document.getElementById("select-all-phones") as HTMLButtonElement;
const clearPhoneSelectionButton = document.getElementById("clear-phone-selection") as HTMLButtonElement;
const phoneReviewEmpty = document.getElementById("phone-review-empty")!;
const phoneReviewList = document.getElementById("phone-review-list")!;
const sendPhoneNumbersButton = document.getElementById("send-phone-numbers") as HTMLButtonElement;
const phoneSyncResult = document.getElementById("phone-sync-result")!;
const syncSubmittedCount = document.getElementById("sync-submitted-count")!;
const syncAddedCount = document.getElementById("sync-added-count")!;
const syncExistingCount = document.getElementById("sync-existing-count")!;
const syncInvalidCount = document.getElementById("sync-invalid-count")!;
const syncDuplicateCount = document.getElementById("sync-duplicate-count")!;
const phoneSyncDialog = document.getElementById("phone-sync-confirmation") as HTMLDialogElement;
const confirmSelectedCount = document.getElementById("confirm-selected-count")!;
const confirmPhoneSyncButton = document.getElementById("confirm-phone-sync") as HTMLButtonElement;
const cancelPhoneSyncButton = document.getElementById("cancel-phone-sync") as HTMLButtonElement;
const phoneSyncCategoryInput = document.getElementById("phone-sync-category") as HTMLInputElement;
const recoveryPanel = document.getElementById("recovery-panel")!;
const recoveryCandidatesElement = document.getElementById("recovery-candidates")!;
const recoveryStatusElement = document.getElementById("recovery-status")!;
const createNewConnectionButton = document.getElementById("create-new-connection") as HTMLButtonElement;
const connectionDetailElement = document.getElementById("connection-detail")!;
const connectionAccountElement = document.getElementById("connection-account")!;
const connectionUpdatedElement = document.getElementById("connection-updated")!;
const refreshConnectionButton = document.getElementById("refresh-connection") as HTMLButtonElement;
const connectionProgressElement = document.getElementById("connection-progress")!;
const setupStepAccount = document.getElementById("setup-step-account")!;
const setupStepInstallation = document.getElementById("setup-step-installation")!;
const setupStepFacebook = document.getElementById("setup-step-facebook")!;

let currentExtensionName = "";
let phoneCollectorState = createEmptyPhoneCollectorState();
const phoneEditErrors = new Map<string, string>();

// Writes phone collector diagnostics to the popup DevTools console without storing them.
function logPhoneCollector(
  level: "info" | "warn" | "error",
  message: string,
  details?: Record<string, string | number>,
) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger(`[PostFlow][Phone Collector] ${message}`, details ?? "");
}

// Creates the initial versioned state used before the first collection.
function createEmptyPhoneCollectorState(): PhoneCollectorState {
  return {
    schemaVersion: 1,
    collectionStatus: "idle",
    source: null,
    candidates: [],
    numbers: [],
    summary: { found: 0, valid: 0, duplicates: 0, invalid: 0 },
    syncStatus: "idle",
  };
}

// Switches the popup between its existing dashboard and the collector view.
function setActivePopupView(view: "dashboard" | "phone-collector") {
  const collectorActive = view === "phone-collector";
  dashboardTab.setAttribute("aria-selected", String(!collectorActive));
  dashboardTab.tabIndex = collectorActive ? -1 : 0;
  dashboardTab.classList.toggle("active", !collectorActive);
  phoneCollectorTab.setAttribute("aria-selected", String(collectorActive));
  phoneCollectorTab.tabIndex = collectorActive ? 0 : -1;
  phoneCollectorTab.classList.toggle("active", collectorActive);
  dashboardView.toggleAttribute("hidden", collectorActive);
  phoneCollectorView.toggleAttribute("hidden", !collectorActive);
  if (collectorActive) void loadActivePageDetails();
  void chrome.storage.local.set({ phoneCollectorActiveView: view });
}

// Supports standard left/right and Home/End keyboard navigation for the view tabs.
function handlePopupTabKeydown(event: KeyboardEvent) {
  const tabs = [dashboardTab, phoneCollectorTab];
  const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex < 0) return;

  let nextIndex: number | undefined;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === undefined) return;

  event.preventDefault();
  tabs[nextIndex].focus();
  setActivePopupView(nextIndex === 0 ? "dashboard" : "phone-collector");
}

// Loads the current tab's title and URL for the collector's source context.
async function loadActivePageDetails() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    collectorPageTitle.textContent = tab?.title?.trim() || "Active page";
    collectorPageUrl.textContent = tab?.url || "Page address unavailable";
    collectorPageUrl.setAttribute("title", tab?.url || "Page address unavailable");
  } catch {
    collectorPageTitle.textContent = "Active page unavailable";
    collectorPageUrl.textContent = "Could not read the active tab.";
  }
}

// Restores the saved review list and selected tab when the popup is opened.
async function loadPhoneCollectorState() {
  const result = await chrome.storage.local.get(["phoneCollectorState", "phoneCollectorActiveView"]);
  const savedState = result.phoneCollectorState as PhoneCollectorState | undefined;
  if (savedState?.schemaVersion === 1 && Array.isArray(savedState.numbers)) {
    phoneCollectorState = savedState;
    if (phoneCollectorState.collectionStatus === "collecting") {
      phoneCollectorState.collectionStatus = "error";
      phoneCollectorState.collectionError = "The previous collection was interrupted. Try again.";
      void persistPhoneCollectorState();
    }
    if (phoneCollectorState.syncStatus === "confirming") {
      phoneCollectorState.syncStatus = "idle";
      phoneCollectorState.syncError = undefined;
      void persistPhoneCollectorState();
    } else if (phoneCollectorState.syncStatus === "syncing") {
      phoneCollectorState.syncStatus = "error";
      phoneCollectorState.syncError = "The popup closed during sync. Retry to reconcile the saved numbers.";
      void persistPhoneCollectorState();
    }
  }
  renderPhoneCollector();

  if (result.phoneCollectorActiveView === "phone-collector") {
    setActivePopupView("phone-collector");
  }
}

// Saves the current collection and review choices to extension-local storage.
async function persistPhoneCollectorState() {
  await chrome.storage.local.set({ phoneCollectorState });
}

// Updates the collector status, totals, empty state, and review rows from saved state.
function renderPhoneCollector() {
  const { summary, numbers, collectionStatus } = phoneCollectorState;
  phoneFoundCount.textContent = String(summary.found);
  phoneValidCount.textContent = String(summary.valid);
  phoneDuplicateCount.textContent = String(summary.duplicates);
  phoneInvalidCount.textContent = String(summary.invalid);
  const selectedCount = getSelectedPhoneNumbers().length;
  selectedPhoneCount.textContent = String(selectedCount);
  const syncLocked = phoneCollectorState.syncStatus === "confirming" || phoneCollectorState.syncStatus === "syncing";
  selectAllPhonesButton.disabled = syncLocked || numbers.length === 0;
  clearPhoneSelectionButton.disabled = syncLocked || (numbers.length === 0 && summary.found === 0);
  collectNumbersButton.disabled = collectionStatus === "collecting" || syncLocked;
  collectNumbersButton.textContent = collectionStatus === "collecting" ? "Collecting..." : "Collect Numbers";
  sendPhoneNumbersButton.disabled = selectedCount === 0 ||
    !phoneCollectorState.source ||
    collectionStatus === "collecting" ||
    phoneCollectorState.syncStatus === "confirming" ||
    phoneCollectorState.syncStatus === "syncing";
  sendPhoneNumbersButton.textContent = phoneCollectorState.syncStatus === "syncing"
    ? "Syncing..."
    : `Send ${selectedCount} to PostFlow`;
  confirmSelectedCount.textContent = String(selectedCount);
  confirmPhoneSyncButton.disabled = phoneCollectorState.syncStatus === "syncing";

  if (phoneCollectorState.syncStatus === "syncing") {
    collectorStatus.textContent = "Syncing selected numbers with PostFlow...";
  } else if (phoneCollectorState.syncStatus === "error") {
    collectorStatus.textContent = phoneCollectorState.syncError || "Sync failed. Your selection is available to retry.";
  } else if (phoneCollectorState.syncStatus === "success") {
    collectorStatus.textContent = "Sync complete. See the result below.";
  } else if (phoneCollectorState.syncStatus === "confirming") {
    collectorStatus.textContent = "Confirm the selected numbers to continue.";
  } else if (collectionStatus === "collecting") {
    collectorStatus.textContent = "Collecting phone numbers from the loaded page...";
  } else if (collectionStatus === "error") {
    collectorStatus.textContent = phoneCollectorState.collectionError || "Could not collect numbers from this page.";
  } else if (collectionStatus === "review" && summary.found === 0) {
    collectorStatus.textContent = "No phone numbers were found on this page.";
  } else if (collectionStatus === "review") {
    collectorStatus.textContent = "Collection complete. Review the numbers below.";
  } else {
    collectorStatus.textContent = "Ready to collect numbers from the current page.";
  }
  collectorStatus.classList.toggle("error", phoneCollectorState.syncStatus === "error" || collectionStatus === "error");

  phoneReviewEmpty.textContent = collectionStatus === "collecting"
    ? "Scanning the loaded page..."
    : collectionStatus === "review" && numbers.length === 0
      ? "No reviewable phone numbers were found."
      : "Numbers you collect will appear here.";
  phoneReviewEmpty.toggleAttribute("hidden", numbers.length > 0);
  phoneReviewList.replaceChildren(...numbers.map(renderPhoneReviewNumber));
  const syncResult = phoneCollectorState.syncResult;
  phoneSyncResult.toggleAttribute("hidden", !syncResult);
  if (syncResult) {
    syncSubmittedCount.textContent = String(syncResult.submitted);
    syncAddedCount.textContent = String(syncResult.added);
    syncExistingCount.textContent = String(syncResult.alreadyExisted);
    syncInvalidCount.textContent = String(syncResult.invalid);
    syncDuplicateCount.textContent = String(syncResult.duplicates);
  }
}

// Returns the selected E.164 values from valid review rows.
function getSelectedPhoneNumbers(): string[] {
  return Array.from(new Set(phoneCollectorState.numbers
    .filter((number) => number.status === "valid" && number.selected && Boolean(number.normalized))
    .map((number) => number.normalized!)));
}

// Creates one editable review row and wires its selection, editing, and remove actions.
function renderPhoneReviewNumber(number: PhoneReviewNumber): HTMLElement {
  const row = document.createElement("article");
  row.className = `phone-review-row ${number.status}`;
  const syncLocked = phoneCollectorState.syncStatus === "confirming" || phoneCollectorState.syncStatus === "syncing";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = number.status === "valid" && number.selected;
  checkbox.disabled = number.status !== "valid" || syncLocked;
  checkbox.setAttribute("aria-label", `Select ${number.value}`);
  checkbox.addEventListener("change", () => setPhoneNumberSelected(number.id, checkbox.checked));

  const details = document.createElement("div");
  details.className = "phone-review-details";
  const input = document.createElement("input");
  input.className = "phone-review-input";
  input.type = "tel";
  input.value = number.value;
  input.maxLength = 40;
  input.disabled = syncLocked;
  input.setAttribute("aria-label", `Edit phone number ${number.value}`);
  input.addEventListener("change", () => updatePhoneReviewNumber(number.id, input.value));
  details.append(input);

  const reason = document.createElement("p");
  reason.className = `phone-review-reason ${number.status}`;
  reason.textContent = phoneEditErrors.get(number.id) || (number.status === "valid" ? "Valid" : number.reason || "Invalid number");
  details.append(reason);

  const removeButton = document.createElement("button");
  removeButton.className = "icon-button remove-phone-button";
  removeButton.type = "button";
  removeButton.textContent = "x";
  removeButton.disabled = syncLocked;
  removeButton.setAttribute("aria-label", `Remove ${number.value}`);
  removeButton.title = "Remove number";
  removeButton.addEventListener("click", () => removePhoneReviewNumber(number.id));

  row.append(checkbox, details, removeButton);
  return row;
}

// Changes selection only for rows that have passed client-side validation.
function setPhoneNumberSelected(id: string, selected: boolean) {
  phoneCollectorState.numbers = phoneCollectorState.numbers.map((number) =>
    number.id === id && number.status === "valid" ? { ...number, selected } : number,
  );
  renderPhoneCollector();
  void persistPhoneCollectorState();
}

// Selects every valid review row while leaving invalid values unselected.
function selectAllValidPhoneNumbers() {
  phoneCollectorState.numbers = phoneCollectorState.numbers.map((number) =>
    number.status === "valid" ? { ...number, selected: true } : number,
  );
  renderPhoneCollector();
  void persistPhoneCollectorState();
}

// Clears the complete collection and returns the collector to its initial state.
function clearCollectedPhoneNumbers() {
  if (phoneCollectorState.syncStatus === "confirming" || phoneCollectorState.syncStatus === "syncing") return;
  phoneCollectorState.collectionStatus = "idle";
  phoneCollectorState.source = null;
  phoneCollectorState.candidates = [];
  phoneCollectorState.numbers = [];
  phoneCollectorState.summary = { found: 0, valid: 0, duplicates: 0, invalid: 0 };
  phoneCollectorState.collectionError = undefined;
  phoneCollectorState.syncStatus = "idle";
  phoneCollectorState.syncError = undefined;
  phoneCollectorState.syncResult = undefined;
  phoneCollectorState.syncCategory = undefined;
  phoneEditErrors.clear();
  renderPhoneCollector();
  void persistPhoneCollectorState();
}

// Removes a review row and clears any temporary edit warning associated with it.
function removePhoneReviewNumber(id: string) {
  phoneCollectorState.numbers = phoneCollectorState.numbers.filter((number) => number.id !== id);
  phoneEditErrors.delete(id);
  renderPhoneCollector();
  void persistPhoneCollectorState();
}

// Revalidates an edited value and prevents two rows from sharing one normalized number.
function updatePhoneReviewNumber(id: string, value: string) {
  const result = normalizePhoneNumber(value);
  const existing = phoneCollectorState.numbers.find((number) => number.id === id);
  if (!existing) return;

  if (result.valid && phoneCollectorState.numbers.some((number) => number.id !== id && number.status === "valid" && number.normalized === result.normalized)) {
    phoneEditErrors.set(id, "This number is already in the review list.");
    renderPhoneCollector();
    return;
  }

  phoneEditErrors.delete(id);
  phoneCollectorState.numbers = phoneCollectorState.numbers.map((number) => {
    if (number.id !== id) return number;
    if (!result.valid) return number;
    return {
      ...number,
      value: result.normalized,
      normalized: result.normalized,
      status: "valid",
      selected: number.status === "valid" ? number.selected : true,
      reason: undefined,
    };
  });
  if (!result.valid) {
    phoneCollectorState.numbers = phoneCollectorState.numbers.filter((number) => number.id !== id);
  }
  renderPhoneCollector();
  void persistPhoneCollectorState();
}

// Collects the active page, then stores its candidates, validated rows, and summary.
async function collectPhoneNumbers() {
  logPhoneCollector("info", "Collection started for the active page.");
  phoneCollectorState.collectionStatus = "collecting";
  phoneCollectorState.collectionError = undefined;
  renderPhoneCollector();
  await persistPhoneCollectorState();

  const response = await requestPhoneCollection();
  if (!response.ok || !response.source || !response.candidates || !response.numbers || !response.summary) {
    phoneCollectorState.collectionStatus = "error";
    phoneCollectorState.collectionError = response.error || "Could not collect numbers from this page.";
    logPhoneCollector("error", "Collection failed.", response.code ? { code: response.code } : undefined);
    renderPhoneCollector();
    await persistPhoneCollectorState();
    return;
  }

  phoneCollectorState = {
    schemaVersion: 1,
    collectionStatus: "review",
    source: response.source,
    candidates: response.candidates,
    numbers: response.numbers,
    summary: response.summary,
    syncStatus: "idle",
  };
  phoneEditErrors.clear();
  logPhoneCollector("info", "Collection completed.", {
    valid: response.summary.valid,
    duplicates: response.summary.duplicates,
    invalid: response.summary.invalid,
  });
  collectorPageTitle.textContent = response.source.title || "Active page";
  collectorPageUrl.textContent = response.source.url;
  collectorPageUrl.setAttribute("title", response.source.url);
  renderPhoneCollector();
  await persistPhoneCollectorState();
}

// Opens an explicit confirmation dialog for the currently selected valid numbers.
async function openPhoneSyncConfirmation() {
  const selectedNumbers = getSelectedPhoneNumbers();
  if (!selectedNumbers.length || phoneCollectorState.syncStatus === "syncing") return;

  logPhoneCollector("info", "Sync confirmation opened.", { selected: selectedNumbers.length });
  phoneCollectorState.syncStatus = "confirming";
  phoneCollectorState.syncError = undefined;
  phoneSyncCategoryInput.value = phoneCollectorState.syncCategory ?? "";
  confirmSelectedCount.textContent = String(selectedNumbers.length);
  renderPhoneCollector();
  await persistPhoneCollectorState();
  if (!phoneSyncDialog.open) {
    phoneSyncDialog.showModal();
    phoneSyncCategoryInput.focus();
  }
}

// Closes confirmation without sending and restores the review controls.
function closePhoneSyncConfirmation() {
  if (phoneSyncDialog.open) phoneSyncDialog.close();
  if (phoneCollectorState.syncStatus !== "confirming") return;
  logPhoneCollector("info", "Sync canceled by the user.");
  phoneCollectorState.syncStatus = "idle";
  phoneCollectorState.syncError = undefined;
  renderPhoneCollector();
  void persistPhoneCollectorState();
}

// Resets a confirmation canceled with Escape, while leaving active syncs untouched.
function handlePhoneSyncDialogClose() {
  if (phoneCollectorState.syncStatus !== "confirming") return;
  logPhoneCollector("info", "Sync confirmation dismissed.");
  phoneCollectorState.syncStatus = "idle";
  phoneCollectorState.syncError = undefined;
  renderPhoneCollector();
  void persistPhoneCollectorState();
}

// Sends a sync command to the worker and converts messaging failures to retryable UI errors.
async function requestPhoneSync(): Promise<PhoneSyncResponse> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "SYNC_PHONE_NUMBERS" }) as
      PhoneSyncResponse | undefined;
    return response ?? {
      ok: false,
      code: "WORKER_NO_RESPONSE",
      error: "The extension worker did not respond. Reload PostFlow at chrome://extensions, then retry. Your selection is saved.",
    };
  } catch {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      error: "Could not contact the extension worker. Reload PostFlow at chrome://extensions, then retry. Your selection is saved.",
    };
  }
}

// Confirms and sends the saved selection, retaining all review rows if the request fails.
async function confirmAndSyncPhoneNumbers() {
  if (phoneCollectorState.syncStatus !== "confirming") return;
  const selectedNumbers = getSelectedPhoneNumbers();
  if (!selectedNumbers.length || !phoneCollectorState.source) {
    closePhoneSyncConfirmation();
    return;
  }

  const category = phoneSyncCategoryInput.value.trim().replace(/\s+/g, " ");
  phoneCollectorState.syncCategory = category || undefined;

  logPhoneCollector("info", "Sync confirmed.", { selected: selectedNumbers.length });
  if (phoneSyncDialog.open) phoneSyncDialog.close();
  phoneCollectorState.syncStatus = "syncing";
  phoneCollectorState.syncError = undefined;
  phoneCollectorState.syncResult = undefined;
  renderPhoneCollector();

  try {
    await persistPhoneCollectorState();
    const response = await requestPhoneSync();
    if (response.ok && response.result) {
      phoneCollectorState.syncStatus = "success";
      phoneCollectorState.syncResult = response.result;
      phoneCollectorState.syncError = undefined;
      phoneCollectorState.collectionStatus = "idle";
      phoneCollectorState.source = null;
      phoneCollectorState.candidates = [];
      phoneCollectorState.numbers = [];
      phoneCollectorState.summary = { found: 0, valid: 0, duplicates: 0, invalid: 0 };
      phoneCollectorState.syncCategory = undefined;
      phoneEditErrors.clear();
      logPhoneCollector("info", "Sync completed.", {
        added: response.result.added,
        alreadyExisted: response.result.alreadyExisted,
        invalid: response.result.invalid,
      });
    } else {
      phoneCollectorState.syncStatus = "error";
      phoneCollectorState.syncError = response.error || "Sync failed. Your selection is saved for retry.";
      logPhoneCollector("error", "Sync failed.", {
        ...(response.code ? { code: response.code } : {}),
        ...(typeof response.httpStatus === "number" ? { httpStatus: response.httpStatus } : {}),
      });
    }
  } catch {
    phoneCollectorState.syncStatus = "error";
    phoneCollectorState.syncError = "Could not sync with PostFlow. Your selection is saved for retry.";
    logPhoneCollector("error", "Popup could not complete the sync request.", { code: "NETWORK_ERROR" });
  }

  renderPhoneCollector();
  await persistPhoneCollectorState();
}

dashboardTab.addEventListener("click", () => setActivePopupView("dashboard"));
phoneCollectorTab.addEventListener("click", () => setActivePopupView("phone-collector"));
dashboardTab.addEventListener("keydown", handlePopupTabKeydown);
phoneCollectorTab.addEventListener("keydown", handlePopupTabKeydown);
collectNumbersButton.addEventListener("click", () => void collectPhoneNumbers());
selectAllPhonesButton.addEventListener("click", selectAllValidPhoneNumbers);
clearPhoneSelectionButton.addEventListener("click", clearCollectedPhoneNumbers);
sendPhoneNumbersButton.addEventListener("click", () => void openPhoneSyncConfirmation());
cancelPhoneSyncButton.addEventListener("click", closePhoneSyncConfirmation);
confirmPhoneSyncButton.addEventListener("click", () => void confirmAndSyncPhoneNumbers());
phoneSyncCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void confirmAndSyncPhoneNumbers();
  }
});
phoneSyncDialog.addEventListener("close", handlePhoneSyncDialogClose);

// Requests a page scan through the service worker and converts transport failures to UI state.
async function requestPhoneCollection(): Promise<PhoneCollectionResponse> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "COLLECT_PHONE_NUMBERS" }) as
      PhoneCollectionResponse | undefined;
    return response ?? {
      ok: false,
      code: "COLLECTION_FAILED",
      error: "The extension did not return a collection result.",
    };
  } catch {
    return {
      ok: false,
      code: "COLLECTION_FAILED",
      error: "Could not contact the extension service worker.",
    };
  }
}

function setIndicator(dotId: string, textId: string, text: string, state: string) {
  const dot = document.getElementById(dotId);
  const label = document.getElementById(textId);
  if (dot) dot.className = `status-dot ${state}`;
  if (label) label.textContent = text;
}

function lifecycleLabel(status: string): { text: string; className: string; showDashboardLink: boolean } {
  switch (status) {
    case 'ACTIVE':
      return { text: 'Connected and ready', className: 'ready', showDashboardLink: false };
    case 'PAUSED':
      return { text: 'Paused from PostFlow dashboard', className: 'paused', showDashboardLink: true };
    case 'REVOKE_PENDING':
      return { text: 'Disconnecting after current task', className: 'disconnecting', showDashboardLink: true };
    case 'REVOKED':
      return { text: 'Disconnected from PostFlow', className: 'revoked', showDashboardLink: true };
    default:
      return { text: 'Checking...', className: '', showDashboardLink: false };
  }
}

function facebookHealthLabel(status: string): { text: string; className: string } {
  switch (status) {
    case 'CONNECTED':
      return { text: 'Facebook ready', className: 'ready' };
    case 'LOGIN_REQUIRED':
      return { text: 'Login required', className: 'attention' };
    case 'ACCOUNT_MISMATCH':
      return { text: 'Wrong Facebook account', className: 'attention' };
    case 'BLOCKED':
      return { text: 'Facebook blocked or verification required', className: 'attention' };
    case 'CHECKPOINT_OR_VERIFICATION':
      return { text: 'Facebook checkpoint or verification required', className: 'attention' };
    case 'CAPTCHA_OR_CHALLENGE':
      return { text: 'Facebook captcha or challenge', className: 'attention' };
    case 'MANUAL_INTERVENTION_REQUIRED':
      return { text: 'Manual intervention required', className: 'attention' };
    default:
      return { text: 'Facebook status unknown', className: 'attention' };
  }
}

function setRecoveryBusy(busy: boolean) {
  createNewConnectionButton.disabled = busy;
  recoveryCandidatesElement
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((button) => { button.disabled = busy; });
}

async function requestExtensionRecovery(options: {
  connectionId?: string;
  createNewConnection?: boolean;
  confirmReplacement?: boolean;
}) {
  return chrome.runtime.sendMessage({
    type: "COMPLETE_EXTENSION_RECOVERY",
    ...options,
  }) as Promise<{
    ok?: boolean;
    error?: string;
    confirmationRequired?: boolean;
  }>;
}

async function reconnectCandidate(candidate: RecoveryCandidate) {
  let confirmReplacement = false;
  if (reconnectNeedsConfirmation(candidate)) {
    confirmReplacement = window.confirm(
      `“${recoveryCandidateLabel(candidate)}” still appears online. Replace that installation with this one?`,
    );
    if (!confirmReplacement) return;
  }

  setRecoveryBusy(true);
  recoveryStatusElement.textContent = "Reconnecting...";
  try {
    let result = await requestExtensionRecovery({
      connectionId: candidate.connectionId,
      confirmReplacement,
    });
    if (result.confirmationRequired && !confirmReplacement) {
      const confirmed = window.confirm(
        `“${recoveryCandidateLabel(candidate)}” is still online. Replace that installation with this one?`,
      );
      if (!confirmed) {
        recoveryStatusElement.textContent = "Replacement canceled.";
        return;
      }
      result = await requestExtensionRecovery({
        connectionId: candidate.connectionId,
        confirmReplacement: true,
      });
    }
    if (!result?.ok) {
      recoveryStatusElement.textContent = result?.error ?? "Could not reconnect.";
      return;
    }
    recoveryStatusElement.textContent = "Reconnected.";
    await loadExtensionName();
    await loadConnectionStatus();
  } catch {
    recoveryStatusElement.textContent = "Could not contact the extension worker.";
  } finally {
    setRecoveryBusy(false);
  }
}

function renderRecoveryCandidates(candidates: RecoveryCandidate[]) {
  recoveryCandidatesElement.replaceChildren();
  if (candidates.length === 0) {
    const empty = document.createElement("small");
    empty.textContent = "No previous connection details are available yet. You can create a new connection.";
    recoveryCandidatesElement.append(empty);
    return;
  }
  for (const candidate of candidates) {
    const row = document.createElement("div");
    row.className = "recovery-candidate";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = recoveryCandidateLabel(candidate);
    const detail = document.createElement("small");
    detail.textContent = candidate.activeInstallationOnline
      ? "Previous installation is online — confirmation required"
      : "Keeps the existing name, groups, jobs, and history";
    copy.append(title, detail);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reconnect";
    button.addEventListener("click", () => void reconnectCandidate(candidate));
    row.append(copy, button);
    recoveryCandidatesElement.append(row);
  }
}

function renderSetupProgress(connectionStage: string, hasUserId: boolean) {
  const setupStages = new Set([
    "waiting-for-dashboard",
    "user-found",
    "connecting",
    "verifying-facebook",
    "facebook-required",
    "backend-unavailable",
    "recovery-required",
  ]);
  connectionProgressElement.hidden = !setupStages.has(connectionStage);

  const setStep = (element: HTMLElement, state: "pending" | "active" | "complete", label: string) => {
    element.classList.toggle("active", state === "active");
    element.classList.toggle("complete", state === "complete");
    const dot = element.querySelector<HTMLElement>(".setup-step-dot");
    if (dot) dot.textContent = state === "complete" ? "✓" : label;
  };

  setStep(setupStepAccount, hasUserId ? "complete" : "active", "1");
  if (!hasUserId) {
    setStep(setupStepInstallation, "pending", "2");
    setStep(setupStepFacebook, "pending", "3");
    return;
  }
  const installationReady = ["verifying-facebook", "facebook-required", "recovery-required", "connected"].includes(connectionStage);
  setStep(setupStepInstallation, installationReady ? "complete" : "active", "2");
  setStep(setupStepFacebook, installationReady ? "active" : "pending", "3");
}

async function loadConnectionStatus() {
  const result = await chrome.storage.local.get([
    "clerkUserId",
    "extensionConnectionStage",
    "webAppLastSeenAt",
    "groupsSyncStatus",
    "groupsSyncCount",
    "groupsLastSyncedAt",
    "facebookIdentityVerified",
    "facebookConnectionStatus",
    "extensionLifecycleStatus",
    "extensionWorkerStatus",
    "extensionRecoveryCandidates",
    "detectedFacebookUserId",
  ]);
  const facebookStatus = typeof result.facebookConnectionStatus === "string"
    ? result.facebookConnectionStatus
    : "UNKNOWN";
  const identityVerified = result.facebookIdentityVerified === true;
  const lifecycleStatus = typeof result.extensionLifecycleStatus === "string"
    ? result.extensionLifecycleStatus
    : "ACTIVE";
  const workerStatus = typeof result.extensionWorkerStatus === "string"
    ? result.extensionWorkerStatus
    : "UNKNOWN";
  const connectionStage = typeof result.extensionConnectionStage === "string"
    ? result.extensionConnectionStage
    : result.clerkUserId
      ? "connecting"
      : "waiting-for-dashboard";
  const recoveryCandidates = Array.isArray(result.extensionRecoveryCandidates)
    ? result.extensionRecoveryCandidates as RecoveryCandidate[]
    : [];
  // The worker can know recovery is required before the candidate payload has
  // arrived (for example while the session check is still in flight). Keep the
  // recovery panel visible in that state so the user can still choose
  // “Create new connection” instead of being stranded on “Checking…”.
  const recoveryRequired = connectionStage === "recovery-required";
  const detectedFacebookUserId = typeof result.detectedFacebookUserId === "string"
    ? result.detectedFacebookUserId
    : "";
  renderSetupProgress(connectionStage, typeof result.clerkUserId === "string" && Boolean(result.clerkUserId));

  // Determine the primary lifecycle message (administrative lifecycle)
  const lifecycle = lifecycleLabel(lifecycleStatus);
  // Determine the Facebook health message (separate from administrative lifecycle)
  const health = facebookHealthLabel(facebookStatus);

  const stageLabels: Record<string, { text: string; className: string }> = {
    "waiting-for-dashboard": { text: "Open PostFlow dashboard to connect", className: "attention" },
    "user-found": { text: "PostFlow account found — connecting…", className: "" },
    connecting: { text: "Connecting to PostFlow…", className: "" },
    "verifying-facebook": { text: "Checking Facebook session…", className: "" },
    "facebook-required": { text: "Facebook login required", className: "attention" },
    "backend-unavailable": { text: "API unavailable — retrying…", className: "attention" },
    connected: { text: "Connected", className: "ready" },
  };
  const stageLabel = stageLabels[connectionStage];
  // Primary status describes the actual handshake step, rather than showing
  // ACTIVE while the installation is still unbound or waiting for auth.
  statusElement.textContent = recoveryRequired
    ? "Choose a connection to continue"
    : stageLabel?.text ?? lifecycle.text;
  statusElement.className = `page-status ${recoveryRequired ? "paused" : stageLabel?.className ?? lifecycle.className}`;

  const stageDetails: Record<string, string> = {
    "waiting-for-dashboard": "The extension has not received your PostFlow user ID yet. Keep the signed-in dashboard open and click Connect below.",
    "user-found": "Your PostFlow account was found. Registering this browser installation.",
    connecting: "Authenticating this installation with the PostFlow API.",
    "verifying-facebook": "Facebook is detected. Matching it to your PostFlow connection.",
    "facebook-required": "Your PostFlow account is connected. Open Facebook and sign in so we can verify the Facebook identity.",
    "backend-unavailable": "The API cannot be reached. We will retry automatically.",
    connected: "Ready to claim publishing and maintenance work.",
    "recovery-required": "A previous connection matches this Facebook account. Choose what to restore.",
  };
  connectionDetailElement.textContent = recoveryRequired
    ? stageDetails["recovery-required"]
    : stageDetails[connectionStage] ?? `Lifecycle: ${lifecycle.text}`;
  connectionAccountElement.textContent = detectedFacebookUserId
    ? `Facebook account detected ••••${detectedFacebookUserId.slice(-4)}`
    : "Facebook account not detected yet";
  connectionUpdatedElement.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  refreshConnectionButton.hidden = !["waiting-for-dashboard", "backend-unavailable"].includes(connectionStage);
  refreshConnectionButton.disabled = false;

  recoveryPanel.toggleAttribute("hidden", !recoveryRequired);
  if (recoveryRequired) renderRecoveryCandidates(recoveryCandidates);

  // Show Facebook health separately
  const healthElement = document.getElementById("facebook-health");
  if (healthElement) {
    healthElement.textContent = recoveryRequired
      ? "Facebook detected — choose Reconnect or Create new connection"
      : health.text;
    healthElement.className = `facebook-health ${recoveryRequired ? "attention" : health.className}`;
  }

  // Show/hide dashboard link for paused/revoked states
  const dashboardLinkContainer = document.getElementById("lifecycle-dashboard-link");
  if (dashboardLinkContainer) {
    dashboardLinkContainer.toggleAttribute("hidden", !lifecycle.showDashboardLink);
  }

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
    groupsSummaryElement.textContent = facebookHealthLabel(facebookStatus).text;
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
      "http://localhost:3001/*",
      "http://127.0.0.1:3001/*",
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
      : "http://localhost:3001";
  await chrome.tabs.create({ url: dashboardUrl });
});

const recoveryDashboardLink = document.getElementById("open-dashboard-for-recovery");
if (recoveryDashboardLink) {
  recoveryDashboardLink.addEventListener("click", async (event) => {
    event.preventDefault();
    const existingTabs = await chrome.tabs.query({
      url: [
        "http://localhost:3001/*",
        "http://127.0.0.1:3001/*",
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
        : "http://localhost:3001";
    await chrome.tabs.create({ url: dashboardUrl });
  });
}

openFacebookGroupsButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://www.facebook.com/groups/joins/?nav_source=tab" });
});

createNewConnectionButton.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Create a separate connection? The previous connection and its history will stay unchanged.",
  );
  if (!confirmed) return;
  setRecoveryBusy(true);
  recoveryStatusElement.textContent = "Creating connection...";
  try {
    const result = await requestExtensionRecovery({ createNewConnection: true });
    if (!result?.ok) {
      recoveryStatusElement.textContent = result?.error ?? "Could not create the connection.";
      return;
    }
    recoveryStatusElement.textContent = "Connection created.";
    await loadExtensionName();
    await loadConnectionStatus();
  } catch {
    recoveryStatusElement.textContent = "Could not contact the extension worker.";
  } finally {
    setRecoveryBusy(false);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const relevantKeys = new Set([
    "clerkUserId",
    "extensionConnectionStage",
    "facebookGroups",
    "groupsSyncStatus",
    "groupsSyncCount",
    "groupsLastSyncedAt",
    "webAppLastSeenAt",
    "facebookIdentityVerified",
    "facebookConnectionStatus",
    "extensionLifecycleStatus",
    "extensionWorkerStatus",
    "extensionRecoveryCandidates",
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
      extensionNameInput.focus();
      extensionNameInput.select();
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
loadPhoneCollectorState();

refreshConnectionButton.addEventListener("click", async () => {
  refreshConnectionButton.disabled = true;
  refreshConnectionButton.textContent = "Requesting dashboard identity…";
  connectionDetailElement.textContent = "Asking the signed-in PostFlow dashboard for your user ID…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "REFRESH_AUTH_CONTEXT" });
    if (!result?.ok) {
      connectionDetailElement.textContent = result?.error ?? "Open the signed-in PostFlow dashboard, then try again.";
    }
  } catch {
    connectionDetailElement.textContent = "Could not contact the extension worker. Reload the extension and try again.";
  } finally {
    refreshConnectionButton.textContent = "Connect to PostFlow dashboard";
    await loadConnectionStatus();
  }
});
