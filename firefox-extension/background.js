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
const REQUEST_TYPES = ["main_frame", "sub_frame"];
const CONTENT_TYPE_BY_KIND = {
  html: "text/html; charset=utf-8"
};
const SYSTEM_PROMPT = `You rewrite web pages for direct browser use.

Goals:
- Remove ads, popups, autoplay, bright distracting visual clutter, nag screens, and attention traps.
- Preserve the page's core information architecture, useful content, links, forms, and navigation as much as possible.
- Return syntactically valid static HTML.
- Do not include scripts, inline event handlers, javascript: URLs, or script-dependent placeholders.
- Do not wrap the result in markdown fences.

Output rules:
- Return a JSON object only.
- The object must contain a string field named "content".
- "content" must be the complete rewritten HTML response body, not a diff or explanation.`;

let settingsCache = { ...DEFAULT_SETTINGS };
const requestContexts = new Map();

class PassThroughResponse extends Error {}

initializeSettings().catch((error) => {
  console.error("zappa init failed", error);
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  for (const [key, change] of Object.entries(changes)) {
    settingsCache[key] = change.newValue;
  }
  settingsCache = normalizeSettings(settingsCache);
});

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!shouldRewriteRequest(details)) {
      return {};
    }
    const headers = details.requestHeaders ? [...details.requestHeaders] : [];
    upsertHeader(headers, "Accept-Encoding", "identity");
    return { requestHeaders: headers };
  },
  { urls: ["<all_urls>"], types: REQUEST_TYPES },
  ["blocking", "requestHeaders"]
);

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const context = requestContexts.get(details.requestId);
    if (!context) {
      return {};
    }

    context.responseHeaders = details.responseHeaders ? [...details.responseHeaders] : [];
    const headers = context.responseHeaders;

    removeHeader(headers, "content-encoding");
    removeHeader(headers, "content-length");
    removeHeader(headers, "content-security-policy");
    removeHeader(headers, "content-security-policy-report-only");
    removeHeader(headers, "etag");
    removeHeader(headers, "last-modified");
    removeHeader(headers, "report-to");
    removeHeader(headers, "transfer-encoding");
    removeHeader(headers, "x-webkit-csp");
    upsertHeader(headers, "Cache-Control", "no-store");
    upsertHeader(headers, "Content-Type", CONTENT_TYPE_BY_KIND[context.assetKind]);
    upsertHeader(headers, "X-Zappa-Backend", settingsCache.backend);
    upsertHeader(headers, "X-Zappa-Transform", "rewritten");

    return { responseHeaders: headers };
  },
  { urls: ["<all_urls>"], types: REQUEST_TYPES },
  ["blocking", "responseHeaders"]
);

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!shouldRewriteRequest(details)) {
      return;
    }

    const assetKind = assetKindFromRequestType(details.type);
    if (!assetKind) {
      return;
    }

    const context = {
      requestId: details.requestId,
      url: details.url,
      siteHost: getSiteHostFromDetails(details),
      assetKind,
      responseHeaders: []
    };

    const filter = browser.webRequest.filterResponseData(details.requestId);
    const chunks = [];

    filter.ondata = (event) => {
      chunks.push(new Uint8Array(event.data));
    };

    filter.onerror = (event) => {
      console.error("zappa filter error", event.error);
      requestContexts.delete(details.requestId);
      try {
        filter.disconnect();
      } catch (error) {
        console.error("zappa disconnect failed", error);
      }
    };

    filter.onstop = async () => {
      let bodyBytes = new Uint8Array();
      try {
        bodyBytes = concatChunks(chunks);
        const charset = getCharsetFromHeaders(context.responseHeaders);
        const originalText = decodeBytes(bodyBytes, charset);

        if (!originalText.trim()) {
          filter.write(bodyBytes);
          filter.close();
          return;
        }

        const rewrittenText = await rewriteAsset({
          url: context.url,
          assetKind: context.assetKind,
          contentType: getHeaderValue(context.responseHeaders, "content-type") || "",
          source: originalText
        });

        const finalText = sanitizeRewrittenAsset(context.assetKind, rewrittenText);
        filter.write(new TextEncoder().encode(finalText));
        filter.close();
      } catch (error) {
        if (error instanceof PassThroughResponse) {
          console.warn("zappa pass-through", error.message);
          filter.write(bodyBytes);
          filter.close();
          return;
        }
        const errorBody = buildErrorBody(context.assetKind, stringifyError(error));
        filter.write(new TextEncoder().encode(errorBody));
        filter.close();
      } finally {
        requestContexts.delete(details.requestId);
      }
    };

    requestContexts.set(details.requestId, context);
  },
  { urls: ["<all_urls>"], types: REQUEST_TYPES },
  ["blocking"]
);

browser.webRequest.onErrorOccurred.addListener(
  (details) => {
    requestContexts.delete(details.requestId);
  },
  { urls: ["<all_urls>"], types: REQUEST_TYPES }
);

async function initializeSettings() {
  const devSettings = await loadDevSettings();
  const defaults = normalizeSettings({ ...DEFAULT_SETTINGS, ...devSettings });
  Object.assign(DEFAULT_SETTINGS, defaults);
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  settingsCache = normalizeSettings(applyForcedDevSettings(stored, devSettings));
  await browser.storage.local.set(settingsCache);
}

async function loadDevSettings() {
  try {
    const response = await fetch(browser.runtime.getURL(DEV_SETTINGS_PATH), { cache: "no-store" });
    if (response.status === 404) {
      return {};
    }
    if (!response.ok) {
      console.warn(`zappa dev settings HTTP ${response.status}`);
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

function normalizeSettings(raw) {
  const disabledHosts = Array.isArray(raw.disabledHosts)
    ? Array.from(new Set(raw.disabledHosts.map(normalizeHost).filter(Boolean))).sort()
    : [];
  const allowedHosts = Array.isArray(raw.allowedHosts)
    ? Array.from(new Set(raw.allowedHosts.map(normalizeHost).filter(Boolean))).sort()
    : [];

  return {
    enabled: Boolean(raw.enabled),
    configured: Boolean(raw.configured),
    allowedHosts,
    disabledHosts,
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBackend(backend) {
  if (backend === "openai_compatible") {
    return "openai_compatible";
  }
  return "pi_codex";
}

function toPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function shouldRewriteRequest(details) {
  if (!settingsCache.enabled) {
    return false;
  }
  if (!settingsCache.configured) {
    return false;
  }
  if (!REQUEST_TYPES.includes(details.type)) {
    return false;
  }
  if (!isHttpUrl(details.url)) {
    return false;
  }
  const siteHost = getSiteHostFromDetails(details);
  if (!siteHost || !settingsCache.allowedHosts.includes(siteHost)) {
    return false;
  }
  return Boolean(assetKindFromRequestType(details.type));
}

function assetKindFromRequestType(type) {
  if (type === "main_frame" || type === "sub_frame") {
    return "html";
  }
  return null;
}

function getSiteHostFromDetails(details) {
  if (details.documentUrl) {
    return hostnameFromUrl(details.documentUrl);
  }
  if (details.originUrl) {
    return hostnameFromUrl(details.originUrl);
  }
  return hostnameFromUrl(details.url);
}

function hostnameFromUrl(url) {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch (error) {
    return "";
  }
}

function normalizeHost(host) {
  return typeof host === "string" ? host.trim().toLowerCase() : "";
}

function isHttpUrl(url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

function upsertHeader(headers, name, value) {
  const lowerName = name.toLowerCase();
  const existing = headers.find((header) => header.name.toLowerCase() === lowerName);
  if (existing) {
    existing.value = value;
    return;
  }
  headers.push({ name, value });
}

function removeHeader(headers, name) {
  const lowerName = name.toLowerCase();
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    if (headers[index].name.toLowerCase() === lowerName) {
      headers.splice(index, 1);
    }
  }
}

function getHeaderValue(headers, name) {
  const lowerName = name.toLowerCase();
  const header = headers.find((item) => item.name.toLowerCase() === lowerName);
  return header ? header.value : "";
}

function getCharsetFromHeaders(headers) {
  const contentType = getHeaderValue(headers, "content-type");
  const match = /charset=([^;]+)/i.exec(contentType);
  return match ? match[1].trim() : "utf-8";
}

function concatChunks(chunks) {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.byteLength;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function decodeBytes(bytes, charset) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch (error) {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function sanitizeRewrittenAsset(assetKind, content) {
  if (assetKind !== "html") {
    return content;
  }
  return content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*"javascript:[^"]*"/gi, " $1=\"#\"")
    .replace(/\s+(href|src)\s*=\s*'javascript:[^']*'/gi, " $1=\"#\"")
    .replace(/\s+(href|src)\s*=\s*javascript:[^\s>]*/gi, " $1=\"#\"");
}

function buildErrorBody(assetKind, message) {
  if (assetKind === "html") {
    const escaped = escapeHtml(message);
    return (
      "<!doctype html>" +
      "<html><head><meta charset=\"utf-8\"><title>zappa error</title></head>" +
      "<body style=\"font-family: monospace; padding: 2rem;\">" +
      "<h1>zappa error</h1>" +
      `<pre style="white-space: pre-wrap;">${escaped}</pre>` +
      "</body></html>"
    );
  }
  return message;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function rewriteAsset({ url, assetKind, contentType, source }) {
  if (source.length > settingsCache.maxInputChars) {
    throw new PassThroughResponse(`asset too large (${source.length} > ${settingsCache.maxInputChars})`);
  }

  return rewriteWithOpenAICompatible({ url, assetKind, contentType, source });
}

async function rewriteWithOpenAICompatible({ url, assetKind, contentType, source }) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (settingsCache.apiKey.trim()) {
    headers.Authorization = `Bearer ${settingsCache.apiKey.trim()}`;
  }

  const payload = {
    model: settingsCache.model,
    temperature: 0,
    max_tokens: settingsCache.maxOutputTokens,
    messages: buildMessages({ url, assetKind, contentType, source })
  };

  const response = await fetchJson(`${trimTrailingSlash(settingsCache.baseUrl)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI-compatible backend did not return assistant content");
  }

  const parsed = parseModelJson(content);
  if (typeof parsed.content !== "string" || !parsed.content) {
    throw new Error("OpenAI-compatible JSON output did not contain content");
  }
  return parsed.content;
}

function buildMessages({ url, assetKind, contentType, source }) {
  return [
    {
      role: "system",
      content: SYSTEM_PROMPT
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          url,
          asset_kind: assetKind,
          content_type: contentType,
          source
        }
      )
    }
  ];
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`backend HTTP ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`backend returned invalid JSON: ${text}`);
  }
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("model did not return JSON");
    }
    return JSON.parse(match[0]);
  }
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
