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
const REQUEST_TYPES = ["main_frame", "sub_frame"];
const CONTENT_TYPE_BY_KIND = {
  html: "text/html; charset=utf-8"
};
const REDUCED_HTML_DROP_SELECTORS = [
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "canvas",
  "svg",
  "source",
  "track",
  "object",
  "embed",
  "video",
  "audio",
  "link",
  "meta",
  "[hidden]",
  "[inert]",
  "[aria-hidden=\"true\"]"
];
const REDUCED_HTML_CONTENT_SELECTORS = [
  "main",
  "article",
  "[role=\"main\"]"
];
const REDUCED_HTML_ALLOWED_ATTRS = new Set([
  "href",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "loading",
  "decoding",
  "datetime",
  "cite",
  "colspan",
  "rowspan",
  "scope",
  "action",
  "method",
  "name",
  "type",
  "value",
  "placeholder",
  "checked",
  "selected",
  "disabled",
  "required"
]);
const REDUCED_HTML_URL_ATTRS = new Set(["href", "src", "cite", "action"]);
const REDUCED_HTML_EMPTY_KEEP_TAGS = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "source",
  "track",
  "wbr"
]);
const REDUCED_HTML_UNWRAP_TAGS = new Set(["div", "span"]);
const REDUCED_HTML_MAX_NAV_LINKS = 30;
const REDUCED_HTML_MAX_ATTR_CHARS = 600;
const MARKDOWN_RAW_HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "details",
  "div",
  "figure",
  "figcaption",
  "form",
  "img",
  "main",
  "nav",
  "picture",
  "section",
  "summary",
  "table"
]);
const RENDERED_HTML_ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "article",
  "b",
  "blockquote",
  "br",
  "button",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "mark",
  "ol",
  "option",
  "p",
  "pre",
  "q",
  "samp",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var"
]);
const RENDERED_HTML_ALLOWED_ATTRS = new Set([
  "action",
  "alt",
  "checked",
  "cite",
  "colspan",
  "datetime",
  "decoding",
  "disabled",
  "for",
  "height",
  "href",
  "id",
  "loading",
  "method",
  "name",
  "placeholder",
  "rel",
  "required",
  "rowspan",
  "scope",
  "selected",
  "src",
  "title",
  "type",
  "value",
  "width"
]);
const READER_CSS = `
:root {
  color-scheme: light dark;
  --zappa-bg: #f7f7f4;
  --zappa-fg: #181816;
  --zappa-muted: #686861;
  --zappa-border: #d9d8d0;
  --zappa-link: #175c8f;
  --zappa-code-bg: #ecebe4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --zappa-bg: #181816;
    --zappa-fg: #efeee7;
    --zappa-muted: #aaa79a;
    --zappa-border: #3d3b34;
    --zappa-link: #8fc7ff;
    --zappa-code-bg: #24231f;
  }
}
* { box-sizing: border-box; }
html { background: var(--zappa-bg); color: var(--zappa-fg); }
body {
  margin: 0;
  font: 18px/1.58 ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  text-rendering: optimizeLegibility;
}
.zappa-reader {
  width: min(100% - 32px, 760px);
  margin: 0 auto;
  padding: 40px 0 72px;
}
h1, h2, h3, h4, h5, h6 {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.18;
  margin: 2rem 0 0.75rem;
}
h1 { font-size: 2.25rem; margin-top: 0; }
h2 { font-size: 1.55rem; }
h3 { font-size: 1.25rem; }
p, ul, ol, blockquote, pre, table, figure, details, form { margin: 1rem 0; }
a { color: var(--zappa-link); text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 1.25rem auto;
  border-radius: 6px;
}
figure { margin: 1.5rem 0; }
figure img { margin-bottom: 0.5rem; }
figcaption { color: var(--zappa-muted); font-size: 0.9rem; text-align: center; }
blockquote {
  border-left: 4px solid var(--zappa-border);
  color: var(--zappa-muted);
  padding-left: 1rem;
}
pre, code {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  background: var(--zappa-code-bg);
}
code { border-radius: 4px; padding: 0.1rem 0.25rem; font-size: 0.92em; }
pre { border-radius: 8px; overflow-x: auto; padding: 1rem; }
pre code { background: transparent; padding: 0; }
table {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
  width: 100%;
}
th, td { border-bottom: 1px solid var(--zappa-border); padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
input, select, textarea, button {
  color: inherit;
  font: 1rem ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-width: 100%;
}
hr { border: 0; border-top: 1px solid var(--zappa-border); margin: 2rem 0; }
@media (max-width: 640px) {
  body { font-size: 16px; }
  .zappa-reader { width: min(100% - 24px, 760px); padding-top: 24px; }
  h1 { font-size: 1.85rem; }
}
`;
const SYSTEM_PROMPT = `You rewrite web pages for direct browser use.

Goals:
- Remove ads, popups, autoplay, bright distracting visual clutter, nag screens, and attention traps.
- Preserve the page's core information architecture, useful content, links, forms, and navigation as much as possible.
- Return clean Markdown that the browser extension will render to static HTML.
- Do not include scripts, inline event handlers, javascript: URLs, or script-dependent placeholders.
- Do not wrap the result in markdown fences.
- Make the content read like a polished Markdown-rendered reader page, not raw extracted markup.
- Preserve useful original images, alt text, captions, links, and image width/height or aspect ratio cues when present.
- Use Markdown for normal prose, headings, lists, links, blockquotes, and code.
- Use small safe HTML blocks only when Markdown is insufficient, such as <figure>, <img width height alt>, complex tables, or forms.
- When using images, preserve useful width and height attributes from the source if available; avoid huge, distorted, or cropped images.

Output rules:
- Return a JSON object only.
- The object must contain "format":"markdown" and a string field named "content".
- The object may contain a short string field named "title".
- "content" must be the complete rewritten Markdown body, not a diff or explanation.`;

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
      responseHeaders: [],
      startedAt: Date.now()
    };
    updateRewriteStatus({
      state: "capturing",
      progress: 15,
      message: "Capturing page",
      detail: shortUrl(context.url),
      url: context.url,
      host: context.siteHost,
      startedAt: context.startedAt
    });

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
          await updateRewriteStatus({
            state: "passed",
            progress: 100,
            message: "Passed through empty response",
            detail: shortUrl(context.url),
            url: context.url,
            host: context.siteHost,
            startedAt: context.startedAt
          });
          filter.write(bodyBytes);
          filter.close();
          return;
        }

        await updateRewriteStatus({
          state: "queued",
          progress: 30,
          message: "Preparing rewrite",
          detail: `${formatCount(originalText.length)} chars`,
          url: context.url,
          host: context.siteHost,
          sourceChars: originalText.length,
          startedAt: context.startedAt
        });
        const rewrittenText = await rewriteAsset({
          url: context.url,
          host: context.siteHost,
          assetKind: context.assetKind,
          contentType: getHeaderValue(context.responseHeaders, "content-type") || "",
          source: originalText,
          startedAt: context.startedAt
        });

        const finalText = sanitizeRewrittenAsset(context.assetKind, rewrittenText);
        await updateRewriteStatus({
          state: "done",
          progress: 100,
          message: "Rewrite complete",
          detail: `${formatCount(originalText.length)} chars -> ${formatCount(finalText.length)} chars`,
          url: context.url,
          host: context.siteHost,
          sourceChars: originalText.length,
          contentChars: finalText.length,
          startedAt: context.startedAt
        });
        filter.write(new TextEncoder().encode(finalText));
        filter.close();
      } catch (error) {
        if (error instanceof PassThroughResponse) {
          console.warn("zappa pass-through", error.message);
          await updateRewriteStatus({
            state: "passed",
            progress: 100,
            message: "Passed through",
            detail: error.message,
            url: context.url,
            host: context.siteHost,
            startedAt: context.startedAt
          });
          filter.write(bodyBytes);
          filter.close();
          return;
        }
        await updateRewriteStatus({
          state: "error",
          progress: 100,
          message: "Rewrite failed",
          detail: stringifyError(error),
          url: context.url,
          host: context.siteHost,
          startedAt: context.startedAt
        });
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

async function updateRewriteStatus(update) {
  try {
    await browser.storage.local.set({
      rewriteStatus: normalizeRewriteStatus({
        ...DEFAULT_REWRITE_STATUS,
        ...update,
        updatedAt: Date.now()
      })
    });
  } catch (error) {
    console.warn("zappa status update failed", error);
  }
}

function normalizeRewriteStatus(raw) {
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

function toNonNegativeInteger(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
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

async function rewriteAsset({ url, host, assetKind, contentType, source, startedAt }) {
  const modelSource = prepareSourceForModel(assetKind, source, url);
  if (modelSource.length > settingsCache.maxInputChars) {
    throw new PassThroughResponse(
      `asset too large after reduction (${modelSource.length} > ${settingsCache.maxInputChars}; raw ${source.length})`
    );
  }

  await updateRewriteStatus({
    state: "rewriting",
    progress: 45,
    message: "Waiting for Pi",
    detail: modelSource.length === source.length
      ? `${formatCount(source.length)} chars`
      : `${formatCount(source.length)} raw -> ${formatCount(modelSource.length)} reduced`,
    url,
    host,
    sourceChars: source.length,
    startedAt
  });
  return rewriteWithOpenAICompatible({ url, assetKind, contentType, source: modelSource });
}

function prepareSourceForModel(assetKind, source, url = "") {
  if (assetKind !== "html") {
    return source;
  }

  const domReduced = reduceHtmlWithDom(source, url);
  if (domReduced) {
    return domReduced;
  }

  return reduceHtmlWithRegex(source);
}

function reduceHtmlWithRegex(source) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+(?:class|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+nonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+data-[a-z0-9_:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function reduceHtmlWithDom(source, pageUrl) {
  if (typeof DOMParser === "undefined") {
    return "";
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, "text/html");
    if (!doc || !doc.body) {
      return "";
    }

    normalizePictures(doc);
    hydrateImages(doc);
    removeReducedHtmlNoise(doc);
    trimOverlongNavigation(doc);
    cleanReducedHtmlAttributes(doc, pageUrl);
    unwrapReducedHtmlContainers(doc);
    removeEmptyReducedHtmlNodes(doc);

    const title = compactText(doc.title || "");
    const bodyHtml = serializeReducedHtmlBody(doc);
    if (!bodyHtml.trim()) {
      return "";
    }

    return compactHtml(
      "<!doctype html><html><head><meta charset=\"utf-8\">" +
      (title ? `<title>${escapeHtml(title)}</title>` : "") +
      `</head><body>${bodyHtml}</body></html>`
    );
  } catch (error) {
    console.warn("zappa DOM reduction failed", error);
    return "";
  }
}

function normalizePictures(doc) {
  for (const picture of Array.from(doc.querySelectorAll("picture"))) {
    const image = picture.querySelector("img");
    if (image) {
      picture.replaceWith(image);
    } else {
      unwrapElement(picture);
    }
  }
}

function hydrateImages(doc) {
  for (const image of Array.from(doc.images || [])) {
    const srcsetSource = bestSrcFromSrcset(image.getAttribute("srcset"));
    const lazySource = firstAttributeValue(image, [
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-url",
      "data-image",
      "data-img-src",
      "data-hi-res-src"
    ]);
    const currentSource = image.getAttribute("src") || "";

    if ((!currentSource || isPlaceholderImageSource(currentSource)) && (lazySource || srcsetSource)) {
      image.setAttribute("src", lazySource || srcsetSource);
    }

    if (srcsetSource && isPlaceholderImageSource(image.getAttribute("src") || "")) {
      image.setAttribute("src", srcsetSource);
    }

    const style = image.getAttribute("style") || "";
    const styleWidth = cssPixelValue(style, "width");
    const styleHeight = cssPixelValue(style, "height");
    if (styleWidth && !image.getAttribute("width")) {
      image.setAttribute("width", styleWidth);
    }
    if (styleHeight && !image.getAttribute("height")) {
      image.setAttribute("height", styleHeight);
    }
  }
}

function removeReducedHtmlNoise(doc) {
  for (const node of Array.from(doc.querySelectorAll(REDUCED_HTML_DROP_SELECTORS.join(",")))) {
    node.remove();
  }

  for (const node of Array.from(doc.body.querySelectorAll("*"))) {
    if (isInvisibleElement(node) || isLikelyClutterElement(node)) {
      node.remove();
    }
  }

  const contentRoots = selectReducedHtmlContentRoots(doc);
  if (!contentRoots.length) {
    return;
  }

  for (const node of Array.from(doc.body.querySelectorAll("header, footer, aside"))) {
    if (!contentRoots.some((root) => root === node || root.contains(node))) {
      node.remove();
    }
  }
}

function trimOverlongNavigation(doc) {
  for (const nav of Array.from(doc.querySelectorAll("nav"))) {
    const links = Array.from(nav.querySelectorAll("a"));
    for (const link of links.slice(REDUCED_HTML_MAX_NAV_LINKS)) {
      link.remove();
    }
    if (!compactText(nav.textContent || "")) {
      nav.remove();
    }
  }
}

function cleanReducedHtmlAttributes(doc, pageUrl) {
  const fragmentIds = collectFragmentIds(doc);
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name === "id") {
        if (fragmentIds.has(value) && value.length <= 120) {
          continue;
        }
        element.removeAttribute(attribute.name);
        continue;
      }

      if (
        name.startsWith("on") ||
        name === "class" ||
        name === "style" ||
        name === "srcset" ||
        name === "sizes" ||
        name === "integrity" ||
        name === "nonce" ||
        name.startsWith("data-") ||
        name.startsWith("aria-")
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (!REDUCED_HTML_ALLOWED_ATTRS.has(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (REDUCED_HTML_URL_ATTRS.has(name)) {
        if (!isSafeReducedHtmlUrl(value)) {
          element.removeAttribute(attribute.name);
          continue;
        }
        const resolved = resolveReducedHtmlUrl(value, pageUrl);
        if (resolved) {
          element.setAttribute(name, resolved);
        }
      }

      if ((name === "width" || name === "height") && !isSafeDimensionValue(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (element.getAttribute(name) && element.getAttribute(name).length > REDUCED_HTML_MAX_ATTR_CHARS) {
        element.setAttribute(name, element.getAttribute(name).slice(0, REDUCED_HTML_MAX_ATTR_CHARS));
      }
    }

    if (tagName === "img") {
      if (!element.getAttribute("src")) {
        element.remove();
      } else if (!element.getAttribute("loading")) {
        element.setAttribute("loading", "lazy");
      }
    }
  }
}

function unwrapReducedHtmlContainers(doc) {
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();
    if (REDUCED_HTML_UNWRAP_TAGS.has(tagName) && !element.attributes.length) {
      unwrapElement(element);
    }
  }
}

function removeEmptyReducedHtmlNodes(doc) {
  const elements = Array.from(doc.body.querySelectorAll("*")).reverse();
  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    if (REDUCED_HTML_EMPTY_KEEP_TAGS.has(tagName)) {
      continue;
    }
    if (compactText(element.textContent || "")) {
      continue;
    }
    if (element.querySelector("img, input, select, textarea, video, audio")) {
      continue;
    }
    element.remove();
  }
}

function serializeReducedHtmlBody(doc) {
  const roots = selectReducedHtmlContentRoots(doc);
  if (!roots.length) {
    return doc.body.innerHTML;
  }

  return roots.map((root) => root.outerHTML).join("\n");
}

function selectReducedHtmlContentRoots(doc) {
  const candidates = [];
  for (const selector of REDUCED_HTML_CONTENT_SELECTORS) {
    candidates.push(...Array.from(doc.body.querySelectorAll(selector)));
  }

  const usefulRoots = candidates.filter((node) => {
    const textLength = compactText(node.textContent || "").length;
    return textLength >= 160 || Boolean(node.querySelector("img, table, figure, form"));
  });

  return usefulRoots.filter((node, index) => {
    return usefulRoots.findIndex((other) => other !== node && other.contains(node)) === -1 &&
      usefulRoots.indexOf(node) === index;
  });
}

function collectFragmentIds(doc) {
  const ids = new Set();
  for (const link of Array.from(doc.querySelectorAll("a[href^=\"#\"]"))) {
    const fragment = link.getAttribute("href").slice(1);
    if (fragment) {
      ids.add(fragment);
    }
  }
  return ids;
}

function isInvisibleElement(element) {
  const style = element.getAttribute("style") || "";
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?)(?:\s*;|$)/i.test(style);
}

function isLikelyClutterElement(element) {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "main" || tagName === "article" || tagName === "body") {
    return false;
  }

  const marker = [
    element.id || "",
    element.className || "",
    element.getAttribute("role") || "",
    element.getAttribute("aria-label") || ""
  ].join(" ").toLowerCase();

  if (!marker) {
    return false;
  }

  return /(^|[\s_-])(?:ad|ads|advert|advertisement|affiliate|analytics|banner|cookie|consent|comments?|dialog|gdpr|modal|newsletter|overlay|paywall|promo|recirc|recommended|related|share|sharing|social|sponsor|sponsored|subscribe|subscription|tracking|widget)([\s_-]|$)/i.test(marker);
}

function unwrapElement(element) {
  const parent = element.parentNode;
  if (!parent) {
    return;
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
}

function firstAttributeValue(element, names) {
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function bestSrcFromSrcset(srcset) {
  if (!srcset || typeof srcset !== "string") {
    return "";
  }

  let bestUrl = "";
  let bestScore = -1;
  for (const candidate of srcset.split(",")) {
    const parts = candidate.trim().split(/\s+/);
    if (!parts[0]) {
      continue;
    }
    const descriptor = parts[1] || "";
    const scoreMatch = /([0-9.]+)(w|x)$/i.exec(descriptor);
    const score = scoreMatch ? Number.parseFloat(scoreMatch[1]) : 0;
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = parts[0];
    }
  }
  return bestUrl;
}

function isPlaceholderImageSource(src) {
  return !src ||
    src.startsWith("data:") ||
    /(?:spacer|blank|placeholder|transparent|pixel)\.(?:gif|png|jpg|jpeg|webp)(?:[?#].*)?$/i.test(src);
}

function cssPixelValue(style, propertyName) {
  const pattern = new RegExp(`(?:^|;)\\s*${propertyName}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)px\\b`, "i");
  const match = pattern.exec(style);
  return match ? String(Math.round(Number.parseFloat(match[1]))) : "";
}

function isSafeDimensionValue(value) {
  return /^[0-9]{1,5}$/.test(String(value).trim());
}

function isSafeReducedHtmlUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return false;
  }
  return !/^(?:javascript|data|vbscript):/i.test(trimmed);
}

function resolveReducedHtmlUrl(value, pageUrl) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.startsWith("#") || /^(?:mailto|tel):/i.test(trimmed)) {
    return trimmed;
  }
  try {
    return new URL(trimmed, pageUrl || undefined).toString();
  } catch (error) {
    return trimmed;
  }
}

function compactHtml(html) {
  return html
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
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
  return renderModelOutput(parsed, url);
}

function renderModelOutput(parsed, pageUrl) {
  const content = parsed.content;
  const title = typeof parsed.title === "string" ? compactText(parsed.title) : "";
  const format = typeof parsed.format === "string" ? parsed.format.toLowerCase() : "";

  if (format === "html" || format === "html_fragment" || looksLikeHtmlDocument(content)) {
    return renderHtmlDocument(content, { title, pageUrl });
  }

  return renderMarkdownDocument(content, { title, pageUrl });
}

function looksLikeHtmlDocument(content) {
  return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(content);
}

function renderMarkdownDocument(markdown, { title = "", pageUrl = "" } = {}) {
  const rendered = renderMarkdownToHtml(markdown);
  const sanitized = sanitizeRenderedHtml(rendered, pageUrl);
  return buildReaderDocument(title || inferTitleFromRenderedHtml(sanitized), sanitized);
}

function renderHtmlDocument(html, { title = "", pageUrl = "" } = {}) {
  const extracted = extractHtmlBody(html);
  const bodyHtml = sanitizeRenderedHtml(extracted.bodyHtml || html, pageUrl);
  return buildReaderDocument(title || extracted.title || inferTitleFromRenderedHtml(bodyHtml), bodyHtml);
}

function extractHtmlBody(html) {
  if (typeof DOMParser === "undefined") {
    return { title: "", bodyHtml: html };
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return {
      title: compactText(doc.title || ""),
      bodyHtml: doc.body ? doc.body.innerHTML : html
    };
  } catch (error) {
    return { title: "", bodyHtml: html };
  }
}

function buildReaderDocument(title, bodyHtml) {
  const safeTitle = title ? escapeHtml(title) : "Zappa Rewrite";
  return (
    "<!doctype html>" +
    "<html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    `<title>${safeTitle}</title>` +
    `<style>${READER_CSS}</style>` +
    "</head><body>" +
    `<main class="zappa-reader">${bodyHtml}</main>` +
    "</body></html>"
  );
}

function renderMarkdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = /^```([a-z0-9_-]+)?\s*$/i.exec(trimmed);
    if (fenceMatch) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (isRawMarkdownHtmlBlock(trimmed)) {
      const rawLines = [line];
      index += 1;
      while (index < lines.length && lines[index].trim()) {
        rawLines.push(lines[index]);
        index += 1;
      }
      html.push(rawLines.join("\n"));
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderMarkdownInline(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderMarkdownParagraphs(quoteLines)}</blockquote>`);
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      html.push(renderMarkdownTable(tableLines));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isMarkdownBlockStart(lines, index)
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderMarkdownInline(paragraphLines.join(" "))}</p>`);
  }

  return html.join("\n");
}

function renderMarkdownParagraphs(lines) {
  return String(lines.join("\n"))
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderMarkdownInline(paragraph.replace(/\n/g, " ").trim())}</p>`)
    .join("");
}

function isMarkdownBlockStart(lines, index) {
  const trimmed = lines[index].trim();
  return !trimmed ||
    /^```/.test(trimmed) ||
    isRawMarkdownHtmlBlock(trimmed) ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^\s*[-*+]\s+/.test(lines[index]) ||
    /^\s*\d+[.)]\s+/.test(lines[index]) ||
    isMarkdownTableStart(lines, index);
}

function isRawMarkdownHtmlBlock(trimmed) {
  const match = /^<\/?([a-z][a-z0-9-]*)\b/i.exec(trimmed);
  return Boolean(match && MARKDOWN_RAW_HTML_BLOCK_TAGS.has(match[1].toLowerCase()));
}

function isMarkdownTableStart(lines, index) {
  if (index + 1 >= lines.length) {
    return false;
  }
  return /^\s*\|.*\|\s*$/.test(lines[index]) &&
    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function renderMarkdownTable(lines) {
  const rows = lines.map((line) => {
    return line.trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  });
  if (rows.length < 2) {
    return "";
  }
  const headers = rows[0];
  const bodyRows = rows.slice(2);
  return (
    "<table><thead><tr>" +
    headers.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join("") +
    "</tr></thead><tbody>" +
    bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderMarkdownInline(cell)}</td>`).join("")}</tr>`).join("") +
    "</tbody></table>"
  );
}

function renderMarkdownInline(text) {
  const tokens = [];
  let escaped = escapeHtml(String(text || ""));

  escaped = escaped.replace(/`([^`]+)`/g, (match, code) => {
    const token = stashMarkdownToken(tokens, `<code>${code}</code>`);
    return token;
  });

  escaped = escaped.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, alt, url, title = "") => {
    if (!isSafeReducedHtmlUrl(unescapeHtmlEntities(url))) {
      return "";
    }
    const titleAttr = title ? ` title="${title}"` : "";
    return stashMarkdownToken(
      tokens,
      `<img src="${url}" alt="${alt}"${titleAttr} loading="lazy" decoding="async">`
    );
  });

  escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, label, url, title = "") => {
    if (!isSafeReducedHtmlUrl(unescapeHtmlEntities(url))) {
      return label;
    }
    const titleAttr = title ? ` title="${title}"` : "";
    return stashMarkdownToken(tokens, `<a href="${url}"${titleAttr}>${label}</a>`);
  });

  escaped = escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");

  return restoreMarkdownTokens(escaped, tokens);
}

function stashMarkdownToken(tokens, html) {
  const token = `\u0000${tokens.length}\u0000`;
  tokens.push(html);
  return token;
}

function restoreMarkdownTokens(value, tokens) {
  return value.replace(/\u0000(\d+)\u0000/g, (match, index) => tokens[Number(index)] || "");
}

function sanitizeRenderedHtml(html, pageUrl) {
  if (typeof DOMParser === "undefined") {
    return sanitizeRewrittenAsset("html", html);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  for (const node of Array.from(doc.body.querySelectorAll("*"))) {
    const tagName = node.tagName.toLowerCase();
    if (!RENDERED_HTML_ALLOWED_TAGS.has(tagName)) {
      if (["script", "style", "template", "iframe", "object", "embed", "svg", "canvas", "video", "audio", "source", "track"].includes(tagName)) {
        node.remove();
      } else {
        unwrapElement(node);
      }
      continue;
    }

    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcset" ||
        name === "sizes" ||
        name === "integrity" ||
        name === "nonce" ||
        name.startsWith("data-") ||
        name.startsWith("aria-") ||
        !RENDERED_HTML_ALLOWED_ATTRS.has(name)
      ) {
        node.removeAttribute(attribute.name);
        continue;
      }

      if (REDUCED_HTML_URL_ATTRS.has(name)) {
        if (!isSafeReducedHtmlUrl(value)) {
          node.removeAttribute(attribute.name);
          continue;
        }
        const resolved = resolveReducedHtmlUrl(value, pageUrl);
        if (resolved) {
          node.setAttribute(name, resolved);
        }
      }

      if ((name === "width" || name === "height") && !isSafeDimensionValue(value)) {
        node.removeAttribute(attribute.name);
      }
    }

    if (tagName === "img") {
      if (!node.getAttribute("src")) {
        node.remove();
      } else {
        if (!node.getAttribute("loading")) {
          node.setAttribute("loading", "lazy");
        }
        if (!node.getAttribute("decoding")) {
          node.setAttribute("decoding", "async");
        }
      }
    }

    if (tagName === "a") {
      const href = node.getAttribute("href") || "";
      if (!href) {
        unwrapElement(node);
      }
    }
  }

  return doc.body.innerHTML;
}

function inferTitleFromRenderedHtml(html) {
  if (typeof DOMParser === "undefined") {
    return "";
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
    return compactText(doc.querySelector("h1, h2, h3")?.textContent || "");
  } catch (error) {
    return "";
  }
}

function unescapeHtmlEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
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

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 120);
  } catch (error) {
    return url.slice(0, 120);
  }
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}
