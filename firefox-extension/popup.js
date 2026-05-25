const DEFAULT_SETTINGS = {
  enabled: true,
  disabledHosts: [],
  backend: "pi_codex",
  baseUrl: "http://127.0.0.1:19777",
  model: "gpt-5.4-mini",
  apiKey: "",
  maxInputChars: 80000,
  maxOutputTokens: 8192
};

const enabledInput = document.getElementById("enabled");
const currentSiteLabel = document.getElementById("current-site");
const toggleSiteButton = document.getElementById("toggle-site");
const settingsForm = document.getElementById("settings-form");
const backendInput = document.getElementById("backend");
const baseUrlInput = document.getElementById("base-url");
const modelInput = document.getElementById("model");
const apiKeyInput = document.getElementById("api-key");
const maxInputCharsInput = document.getElementById("max-input-chars");
const maxOutputTokensInput = document.getElementById("max-output-tokens");
const disabledSitesList = document.getElementById("disabled-sites");
const statusLabel = document.getElementById("status");

let settings = { ...DEFAULT_SETTINGS };
let currentHost = "";

initialize().catch((error) => {
  showStatus(`Failed to load popup: ${error.message}`, true);
});

enabledInput.addEventListener("change", async () => {
  settings.enabled = enabledInput.checked;
  await browser.storage.local.set({ enabled: settings.enabled });
  showStatus(settings.enabled ? "Rewriting enabled." : "Rewriting disabled.");
});

toggleSiteButton.addEventListener("click", async () => {
  if (!currentHost) {
    return;
  }

  const disabledHosts = new Set(settings.disabledHosts);
  if (disabledHosts.has(currentHost)) {
    disabledHosts.delete(currentHost);
    showStatus(`Enabled rewriting for ${currentHost}.`);
  } else {
    disabledHosts.add(currentHost);
    showStatus(`Disabled rewriting on ${currentHost}.`);
  }

  settings.disabledHosts = Array.from(disabledHosts).sort();
  await browser.storage.local.set({ disabledHosts: settings.disabledHosts });
  render();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  settings.backend = normalizeBackend(backendInput.value);
  settings.baseUrl = baseUrlInput.value.trim() || DEFAULT_SETTINGS.baseUrl;
  settings.model = modelInput.value.trim() || DEFAULT_SETTINGS.model;
  settings.apiKey = apiKeyInput.value;
  settings.maxInputChars = toPositiveInteger(maxInputCharsInput.value, DEFAULT_SETTINGS.maxInputChars);
  settings.maxOutputTokens = toPositiveInteger(maxOutputTokensInput.value, DEFAULT_SETTINGS.maxOutputTokens);

  await browser.storage.local.set({
    backend: settings.backend,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    maxInputChars: settings.maxInputChars,
    maxOutputTokens: settings.maxOutputTokens
  });

  showStatus("Settings saved.");
});

async function initialize() {
  settings = normalizeSettings(await browser.storage.local.get(DEFAULT_SETTINGS));
  currentHost = await getCurrentTabHost();
  render();
}

function render() {
  enabledInput.checked = settings.enabled;
  backendInput.value = settings.backend;
  baseUrlInput.value = settings.baseUrl;
  modelInput.value = settings.model;
  apiKeyInput.value = settings.apiKey;
  maxInputCharsInput.value = String(settings.maxInputChars);
  maxOutputTokensInput.value = String(settings.maxOutputTokens);

  if (currentHost) {
    currentSiteLabel.textContent = currentHost;
    toggleSiteButton.disabled = false;
    toggleSiteButton.textContent = settings.disabledHosts.includes(currentHost)
      ? "Enable on this website"
      : "Disable on this website";
  } else {
    currentSiteLabel.textContent = "No normal website is active in this tab.";
    toggleSiteButton.disabled = true;
    toggleSiteButton.textContent = "Disable on this website";
  }

  disabledSitesList.textContent = "";
  if (!settings.disabledHosts.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No disabled sites yet.";
    disabledSitesList.append(empty);
    return;
  }

  for (const host of settings.disabledHosts) {
    const item = document.createElement("li");
    item.className = "site-row";

    const label = document.createElement("span");
    label.textContent = host;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      settings.disabledHosts = settings.disabledHosts.filter((entry) => entry !== host);
      await browser.storage.local.set({ disabledHosts: settings.disabledHosts });
      if (host === currentHost) {
        showStatus(`Enabled rewriting for ${host}.`);
      } else {
        showStatus(`Removed ${host} from disabled sites.`);
      }
      render();
    });

    item.append(label, removeButton);
    disabledSitesList.append(item);
  }
}

function normalizeSettings(raw) {
  return {
    enabled: Boolean(raw.enabled),
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

function normalizeBackend(backend) {
  if (backend === "openai_compatible") {
    return "openai_compatible";
  }
  return "pi_codex";
}

function normalizeHost(host) {
  return typeof host === "string" ? host.trim().toLowerCase() : "";
}

function toPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
