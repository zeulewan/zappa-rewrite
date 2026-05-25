const DEFAULT_SETTINGS = {
  enabled: true,
  configured: false,
  allowedHosts: [],
  disabledHosts: [],
  backend: "pi_codex",
  baseUrl: "http://127.0.0.1:19777",
  model: "gpt-5.4-mini",
  apiKey: "",
  maxInputChars: 2000000,
  maxOutputTokens: 32768
};

const DEFAULT_REWRITE_STATUS = {
  id: "",
  state: "idle",
  progress: 0,
  message: "Idle",
  detail: "",
  url: "",
  host: "",
  sourceChars: 0,
  contentChars: 0,
  startedAt: 0,
  updatedAt: 0
};
const MAX_COMPLETED_REWRITE_STATUSES = 3;
const STALE_ACTIVE_REWRITE_STATUS_MS = 120000;
const DEV_SETTINGS_PATH = "dev-settings.json";
const FORCED_DEV_SETTING_KEYS = [
  "configured",
  "backend",
  "baseUrl",
  "model",
  "apiKey",
  "maxInputChars",
  "maxOutputTokens"
];
const SETTING_KEYS = [
  "enabled",
  "configured",
  "allowedHosts",
  "disabledHosts",
  "backend",
  "baseUrl",
  "model",
  "apiKey",
  "maxInputChars",
  "maxOutputTokens"
];
const extensionEnabledInput = document.getElementById("extension-enabled");
const extensionStateLabel = document.getElementById("extension-state");
const currentSiteLabel = document.getElementById("current-site");
const toggleSiteButton = document.getElementById("toggle-site");
const rewriteProgress = document.getElementById("rewrite-progress");
const rewriteStatusMessage = document.getElementById("rewrite-status-message");
const rewriteStatusDetail = document.getElementById("rewrite-status-detail");
const rewriteStatusesList = document.getElementById("rewrite-statuses");
const settingsForm = document.getElementById("settings-form");
const backendInput = document.getElementById("backend");
const baseUrlInput = document.getElementById("base-url");
const modelInput = document.getElementById("model");
const apiKeyInput = document.getElementById("api-key");
const maxInputCharsInput = document.getElementById("max-input-chars");
const maxOutputTokensInput = document.getElementById("max-output-tokens");
const allowedSitesList = document.getElementById("allowed-sites");
const statusLabel = document.getElementById("status");

let settings = { ...DEFAULT_SETTINGS };
let rewriteStatus = { ...DEFAULT_REWRITE_STATUS };
let rewriteStatuses = [];
let currentHost = "";
let currentTabId = null;

initialize().catch((error) => {
  showStatus(`Failed to load popup: ${error.message}`, true);
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  let settingsChanged = false;
  for (const key of SETTING_KEYS) {
    if (changes[key]) {
      settings[key] = changes[key].newValue;
      settingsChanged = true;
    }
  }
  if (settingsChanged) {
    settings = normalizeSettings(settings);
  }

  if (changes.rewriteStatus) {
    rewriteStatus = normalizeRewriteStatus(changes.rewriteStatus.newValue || DEFAULT_REWRITE_STATUS);
  }
  if (changes.rewriteStatuses) {
    rewriteStatuses = normalizeRewriteStatuses(changes.rewriteStatuses.newValue);
  }

  if (settingsChanged || changes.rewriteStatus || changes.rewriteStatuses) {
    render();
  }
});

extensionEnabledInput.addEventListener("change", async () => {
  settings.enabled = extensionEnabledInput.checked;
  await browser.storage.local.set({ enabled: settings.enabled });
  if (currentHost && settings.allowedHosts.includes(currentHost)) {
    await reloadCurrentTab();
    showStatus(settings.enabled ? "Zappa is on. Reloading this tab." : "Zappa is off. Reloading this tab.");
  } else {
    showStatus(settings.enabled ? "Zappa is on." : "Zappa is off.");
  }
  render();
});

toggleSiteButton.addEventListener("click", async () => {
  if (!currentHost) {
    return;
  }

  const allowedHosts = new Set(settings.allowedHosts);
  if (allowedHosts.has(currentHost)) {
    allowedHosts.delete(currentHost);
    showStatus(`Disabled rewriting on ${currentHost}.`);
  } else {
    allowedHosts.add(currentHost);
    showStatus(`Enabled rewriting for ${currentHost}.`);
  }

  settings.allowedHosts = Array.from(allowedHosts).sort();
  await browser.storage.local.set({ allowedHosts: settings.allowedHosts });
  await reloadCurrentTab();
  render();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  settings.backend = normalizeBackend(backendInput.value);
  settings.configured = true;
  settings.baseUrl = baseUrlInput.value.trim() || DEFAULT_SETTINGS.baseUrl;
  settings.model = modelInput.value.trim() || DEFAULT_SETTINGS.model;
  settings.apiKey = apiKeyInput.value;
  settings.maxInputChars = toPositiveInteger(maxInputCharsInput.value, DEFAULT_SETTINGS.maxInputChars);
  settings.maxOutputTokens = toPositiveInteger(maxOutputTokensInput.value, DEFAULT_SETTINGS.maxOutputTokens);

  await browser.storage.local.set({
    backend: settings.backend,
    configured: true,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    maxInputChars: settings.maxInputChars,
    maxOutputTokens: settings.maxOutputTokens
  });

  showStatus("Settings saved.");
});

async function initialize() {
  const devSettings = await loadDevSettings();
  const defaults = normalizeSettings({ ...DEFAULT_SETTINGS, ...devSettings });
  Object.assign(DEFAULT_SETTINGS, defaults);
  const stored = await browser.storage.local.get({
    ...DEFAULT_SETTINGS,
    rewriteStatus: DEFAULT_REWRITE_STATUS,
    rewriteStatuses: []
  });
  settings = normalizeSettings(applyForcedDevSettings(stored, devSettings));
  rewriteStatus = normalizeRewriteStatus(stored.rewriteStatus);
  rewriteStatuses = normalizeRewriteStatuses(stored.rewriteStatuses);
  await browser.storage.local.set({
    rewriteStatuses,
    rewriteStatus: rewriteStatuses[0] || DEFAULT_REWRITE_STATUS
  });
  currentHost = await getCurrentTabHost();
  render();
}

async function loadDevSettings() {
  try {
    const response = await fetch(browser.runtime.getURL(DEV_SETTINGS_PATH), { cache: "no-store" });
    if (response.status === 404) {
      return {};
    }
    if (!response.ok) {
      return {};
    }
    const parsed = await response.json();
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function applyForcedDevSettings(stored, devSettings) {
  if (!isPlainObject(devSettings) || devSettings.force !== true) {
    return stored;
  }

  const merged = { ...stored };
  for (const key of FORCED_DEV_SETTING_KEYS) {
    if (Object.hasOwn(devSettings, key)) {
      merged[key] = devSettings[key];
    }
  }
  return merged;
}

function render() {
  extensionEnabledInput.checked = settings.enabled;
  extensionStateLabel.textContent = settings.enabled ? "On" : "Off";
  backendInput.value = settings.backend;
  baseUrlInput.value = settings.baseUrl;
  modelInput.value = settings.model;
  apiKeyInput.value = settings.apiKey;
  maxInputCharsInput.value = String(settings.maxInputChars);
  maxOutputTokensInput.value = String(settings.maxOutputTokens);
  renderRewriteStatus();

  if (currentHost) {
    currentSiteLabel.textContent = currentHost;
    toggleSiteButton.disabled = false;
    toggleSiteButton.textContent = settings.allowedHosts.includes(currentHost)
      ? "Disable on this website"
      : "Enable on this website";
  } else {
    currentSiteLabel.textContent = "No normal website is active in this tab.";
    toggleSiteButton.disabled = true;
    toggleSiteButton.textContent = "Enable on this website";
  }

  allowedSitesList.textContent = "";
  if (!settings.allowedHosts.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No enabled sites yet.";
    allowedSitesList.append(empty);
    return;
  }

  for (const host of settings.allowedHosts) {
    const item = document.createElement("li");
    item.className = "site-row";

    const label = document.createElement("span");
    label.textContent = host;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      settings.allowedHosts = settings.allowedHosts.filter((entry) => entry !== host);
      await browser.storage.local.set({ allowedHosts: settings.allowedHosts });
      if (host === currentHost) {
        showStatus(`Disabled rewriting on ${host}.`);
      } else {
        showStatus(`Removed ${host} from enabled sites.`);
      }
      render();
    });

    item.append(label, removeButton);
    allowedSitesList.append(item);
  }
}

function renderRewriteStatus() {
  const statuses = rewriteStatuses.length ? rewriteStatuses : (rewriteStatus.updatedAt ? [rewriteStatus] : []);
  const activeStatuses = statuses.filter((status) => isActiveStatus(status.state));
  const primaryStatus = activeStatuses[0] || statuses[0] || rewriteStatus;

  rewriteProgress.style.width = `${primaryStatus.progress || 0}%`;
  rewriteProgress.classList.toggle("progress-bar-active", isActiveStatus(primaryStatus.state));

  if (activeStatuses.length > 1) {
    rewriteStatusMessage.textContent = `${activeStatuses.length} rewrites active`;
  } else {
    rewriteStatusMessage.textContent = statusMessage(primaryStatus);
  }
  rewriteStatusDetail.textContent = statusDetail(primaryStatus);
  renderRewriteStatusList(statuses);
}

function renderRewriteStatusList(statuses) {
  rewriteStatusesList.textContent = "";
  if (!statuses.length) {
    return;
  }

  for (const status of statuses.slice(0, 8)) {
    const item = document.createElement("li");
    item.className = "rewrite-status-item";
    item.dataset.state = status.state;
    item.classList.toggle("rewrite-status-item-active", isActiveStatus(status.state));

    const topline = document.createElement("div");
    topline.className = "rewrite-status-topline";

    const host = document.createElement("span");
    host.className = "rewrite-status-host";
    host.textContent = status.host || shortUrl(status.url) || "Unknown site";

    const state = document.createElement("span");
    state.className = "rewrite-status-state";
    state.textContent = status.message || status.state || "Idle";

    topline.append(host, state);

    const track = document.createElement("div");
    track.className = "rewrite-status-mini-track";
    const bar = document.createElement("div");
    bar.className = "rewrite-status-mini-bar";
    bar.style.width = `${status.progress}%`;
    track.append(bar);

    const meta = document.createElement("div");
    meta.className = "rewrite-status-meta";
    meta.textContent = statusDetail(status);

    item.append(topline, track, meta);
    rewriteStatusesList.append(item);
  }
}

function statusMessage(status) {
  if (!status.updatedAt) {
    return "Idle";
  }
  const host = status.host ? ` on ${status.host}` : "";
  return `${status.message || "Idle"}${host}`;
}

function statusDetail(status) {
  const parts = [];
  if (status.detail) {
    parts.push(status.detail);
  }
  if (status.sourceChars) {
    parts.push(`${formatCount(status.sourceChars)} in`);
  }
  if (status.contentChars) {
    parts.push(`${formatCount(status.contentChars)} out`);
  }
  if (status.startedAt && status.updatedAt) {
    parts.push(`${Math.max(0, Math.round((status.updatedAt - status.startedAt) / 1000))}s`);
  }
  const timingSummary = formatTimingSummary(status.timings);
  if (timingSummary) {
    parts.push(timingSummary);
  }
  return parts.join(" | ");
}

function formatTimingSummary(timings) {
  if (!isPlainObject(timings)) {
    return "";
  }
  const labels = [
    ["captureMs", "cap"],
    ["reduceMs", "reduce"],
    ["backendHeadersMs", "headers"],
    ["firstSseMs", "first"],
    ["backendMs", "backend"],
    ["markdownRenderMs", "render"],
    ["totalMs", "total"]
  ];
  return labels
    .filter(([key]) => Number.isFinite(timings[key]))
    .map(([key, label]) => `${label} ${formatDuration(timings[key])}`)
    .join(", ");
}

function isActiveStatus(state) {
  return state === "capturing" || state === "queued" || state === "rewriting";
}

function normalizeSettings(raw) {
  return {
    enabled: Boolean(raw.enabled),
    configured: Boolean(raw.configured),
    allowedHosts: Array.isArray(raw.allowedHosts)
      ? Array.from(new Set(raw.allowedHosts.map(normalizeHost).filter(Boolean))).sort()
      : [],
    disabledHosts: Array.isArray(raw.disabledHosts)
      ? Array.from(new Set(raw.disabledHosts.map(normalizeHost).filter(Boolean))).sort()
      : [],
    backend: normalizeBackend(raw.backend),
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim()
      ? raw.baseUrl.trim()
      : DEFAULT_SETTINGS.baseUrl,
    model: typeof raw.model === "string" && raw.model.trim()
      ? raw.model.trim()
      : DEFAULT_SETTINGS.model,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    maxInputChars: toPositiveInteger(raw.maxInputChars, DEFAULT_SETTINGS.maxInputChars),
    maxOutputTokens: toPositiveInteger(raw.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens)
  };
}

function normalizeRewriteStatus(raw) {
  if (!isPlainObject(raw)) {
    return { ...DEFAULT_REWRITE_STATUS };
  }
  const progress = Number.parseInt(raw.progress, 10);
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    state: typeof raw.state === "string" ? raw.state : DEFAULT_REWRITE_STATUS.state,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
    message: typeof raw.message === "string" ? raw.message : "",
    detail: typeof raw.detail === "string" ? raw.detail : "",
    url: typeof raw.url === "string" ? raw.url : "",
    host: typeof raw.host === "string" ? raw.host : "",
    sourceChars: toNonNegativeInteger(raw.sourceChars),
    contentChars: toNonNegativeInteger(raw.contentChars),
    startedAt: toNonNegativeInteger(raw.startedAt),
    updatedAt: toNonNegativeInteger(raw.updatedAt),
    timings: normalizeTimingMap(raw.timings)
  };
}

function normalizeTimingMap(raw) {
  if (!isPlainObject(raw)) {
    return {};
  }
  const timings = {};
  for (const [key, value] of Object.entries(raw)) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      timings[key] = Math.round(number);
    }
  }
  return timings;
}

function normalizeRewriteStatuses(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return pruneRewriteStatuses(raw
    .map(normalizeRewriteStatus)
    .filter((status) => status.updatedAt)
    .sort(compareRewriteStatuses)
    .slice(0, 8));
}

function pruneRewriteStatuses(statuses) {
  const now = Date.now();
  const active = [];
  const completed = [];
  for (const status of statuses) {
    if (isActiveStatus(status.state)) {
      if (now - status.updatedAt <= STALE_ACTIVE_REWRITE_STATUS_MS) {
        active.push(status);
      }
      continue;
    }
    completed.push(status);
  }
  return [...active, ...completed.slice(0, MAX_COMPLETED_REWRITE_STATUSES)].slice(0, 8);
}

function compareRewriteStatuses(left, right) {
  const leftActive = isActiveStatus(left.state);
  const rightActive = isActiveStatus(right.state);
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }
  return right.updatedAt - left.updatedAt;
}

function normalizeBackend(backend) {
  if (backend === "openai_compatible") {
    return "openai_compatible";
  }
  return "pi_codex";
}

function normalizeHost(host) {
  return typeof host === "string" ? host.trim().toLowerCase() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toNonNegativeInteger(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(ms) {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 80);
  } catch (error) {
    return String(url || "").slice(0, 80);
  }
}

async function getCurrentTabHost() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId = Number.isInteger(tab?.id) ? tab.id : null;
  if (!tab || !tab.url) {
    return "";
  }
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.hostname.toLowerCase();
  } catch (error) {
    return "";
  }
}

async function reloadCurrentTab() {
  if (!Number.isInteger(currentTabId)) {
    return;
  }
  try {
    await browser.tabs.reload(currentTabId);
  } catch (error) {
    console.warn("zappa tab reload failed", error);
  }
}

function showStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.style.color = isError ? "#7d2b2b" : "#1b6b53";
}
