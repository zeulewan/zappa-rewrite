const params = new URLSearchParams(location.search);
const requestId = params.get("id") || "";
const sourceUrl = params.get("url") || "";
const sourceLink = document.getElementById("source-link");
const statusNode = document.getElementById("reader-status");
const contentNode = document.getElementById("reader-content");

let completed = false;
let firstContentSeen = false;

if (sourceUrl) {
  sourceLink.href = sourceUrl;
  sourceLink.textContent = sourceUrl;
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.id !== requestId) {
    return;
  }

  if (message.type === "zappa-reader-status") {
    setStatus(message.message || "Rewriting...");
    return;
  }

  if (message.type === "zappa-reader-html") {
    appendHtml(message.html || "");
    return;
  }

  if (message.type === "zappa-reader-done") {
    completed = true;
    document.body.dataset.zappaState = "done";
    setStatus("");
    updateTitleFromContent();
    return;
  }

  if (message.type === "zappa-reader-error") {
    completed = true;
    document.body.dataset.zappaState = "error";
    showError(message.detail || "Rewrite failed");
  }
});

startRewrite().catch((error) => {
  showError(error instanceof Error ? error.message : String(error));
});

window.addEventListener("pagehide", () => {
  if (!completed && requestId) {
    browser.runtime.sendMessage({ type: "zappa-reader-cancel", id: requestId }).catch(() => {});
  }
});

async function startRewrite() {
  if (!requestId || !sourceUrl) {
    showError("Missing rewrite request.");
    return;
  }
  document.body.dataset.zappaState = "loading";
  setStatus("Fetching page...");
  await browser.runtime.sendMessage({
    type: "zappa-reader-start",
    id: requestId,
    url: sourceUrl
  });
}

function appendHtml(html) {
  if (!html) {
    return;
  }
  if (!firstContentSeen) {
    firstContentSeen = true;
    document.body.classList.add("zappa-content-started");
    document.body.dataset.firstContentMs = String(Math.round(performance.now()));
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  for (const node of Array.from(doc.body.childNodes)) {
    contentNode.append(document.importNode(node, true));
  }
}

function setStatus(message) {
  statusNode.textContent = message;
  statusNode.hidden = !message;
}

function showError(message) {
  statusNode.hidden = false;
  statusNode.className = "zappa-error";
  statusNode.textContent = message;
}

function updateTitleFromContent() {
  const heading = contentNode.querySelector("h1, h2");
  if (heading?.textContent?.trim()) {
    document.title = heading.textContent.trim();
  }
}
