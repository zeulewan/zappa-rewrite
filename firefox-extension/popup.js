const DEFAULT_SETTINGS = {
  enabled: true,
  configured: false,
  allowedHosts: [],
  disabledHosts: [],
  backend: "pi_codex",
  baseUrl: "http://127.0.0.1:19777",
  model: "gpt-5.4-mini",
  apiKey: "",
  maxInputChars: 1000000,
  maxOutputTokens: 32768
};

const DEFAULT_REWRITE_STATUS = {
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
const DEV_SETTINGS_PATH = "dev-settings.json";
const FORCED_DEV_SETTING_KEYS = [
  "enabled",
  "configured",
  "backend",
  "baseUrl",
  "model",
  "apiKey",
  "maxInputChars",
  "maxOutputTokens"
];
const currentSiteLabel = document.getElementById("current-site");
const toggleSiteButton = document.getElementById("toggle-site");
const rewriteProgress = document.getElementById("rewrite-progress");
const rewriteStatusMessage = document.getElementById("rewrite-status-message");
const rewriteStatusDetail = document.getElementById("rewrite-status-detail");
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
let currentHost = "";

initialize().catch((error) => {
  showStatus(`Failed to load popup: ${error.message}`, true);
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.rewriteStatus) {
    return;
  }
  rewriteStatus = normalizeRewriteStatus(changes.rewriteStatus.newValue || DEFAULT_REWRITE_STATUS);
  renderRewriteStatus();
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
    rewriteStatus: DEFAULT_REWRITE_STATUS
  });
  settings = normalizeSettings(applyForcedDevSettings(stored, devSettings));
  rewriteStatus = normalizeRewriteStatus(stored.rewriteStatus);
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
  rewriteProgress.style.width = `${rewriteStatus.progress}%`;
  rewriteProgress.classList.toggle("progress-bar-active", isActiveStatus(rewriteStatus.state));
  rewriteStatusMessage.textContent = statusMessage(rewriteStatus);
  rewriteStatusDetail.textContent = statusDetail(rewriteStatus);
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
  return parts.join(" | ");
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
    state: typeof raw.state === "string" ? raw.state : DEFAULT_REWRITE_STATUS.state,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
    message: typeof raw.message === "string" ? raw.message : "",
    detail: typeof raw.detail === "string" ? raw.detail : "",
    url: typeof raw.url === "string" ? raw.url : "",
    host: typeof raw.host === "string" ? raw.host : "",
    sourceChars: toNonNegativeInteger(raw.sourceChars),
    contentChars: toNonNegativeInteger(raw.contentChars),
    startedAt: toNonNegativeInteger(raw.startedAt),
    updatedAt: toNonNegativeInteger(raw.updatedAt)
  };
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

async function getCurrentTabHost() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
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

function showStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.style.color = isError ? "#7d2b2b" : "#1b6b53";
}
