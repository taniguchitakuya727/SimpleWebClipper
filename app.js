const elements = {
  url: document.querySelector("#urlInput"),
  title: document.querySelector("#titleInput"),
  author: document.querySelector("#authorInput"),
  content: document.querySelector("#contentInput"),
  sheetsEndpoint: document.querySelector("#sheetsEndpointInput"),
  pasteHelp: document.querySelector("#pasteHelpButton"),
  download: document.querySelector("#downloadButton"),
  sendSheets: document.querySelector("#sendSheetsButton"),
  status: document.querySelector("#statusText"),
};

const sheetsEndpointStorageKey = "simple-web-clipper.sheets-endpoint";
const defaultSheetsEndpoint = "https://script.google.com/macros/s/AKfycbxb1kqPApIKDi-9xf0XDsrGWbbBu9fFEkrVTTk6ov_xbxIAaJGZy6l6sl81XUBXdrXR/exec";
let lastDownloadedUrl = "";
elements.sheetsEndpoint.value = localStorage.getItem(sheetsEndpointStorageKey) || defaultSheetsEndpoint;

function setStatus(message) {
  elements.status.textContent = message;
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("empty");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme).toString();
}

function deriveTitle(url) {
  const parsed = new URL(url);
  const lastPath = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!lastPath) return parsed.hostname.replace(/^www\./, "");
  return decodeURIComponent(lastPath).replace(/[-_]+/g, " ");
}

function inferAuthor(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const account = parsed.pathname.split("/").filter(Boolean).at(0);
  return ["x.com", "twitter.com"].includes(host) && account ? `@${account}` : "";
}

function yamlQuote(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

function safeFilename(value) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 90) || "untitled"
  );
}

function authorYaml(author) {
  if (!author.trim()) return "";
  return author
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `  - ${yamlQuote(`[[${name}]]`)}`)
    .join("\n");
}

function buildMarkdown({ url, title, author, content }) {
  const today = new Date().toISOString().slice(0, 10);
  const frontmatter = [
    "---",
    `title: ${yamlQuote(title)}`,
    `source: ${yamlQuote(url)}`,
    "author:",
    authorYaml(author),
    "published:",
    `created: ${today}`,
    "description:",
    "tags:",
    '  - "clippings"',
    "---",
  ].filter((line) => line !== "");

  return `${frontmatter.join("\n")}\n${content.trim() ? `${content.trim()}\n` : ""}`;
}

function buildClipPayload({ url, title, author, content }) {
  const created = new Date().toISOString().slice(0, 10);
  return {
    title,
    source: url,
    url,
    author,
    published: "",
    created,
    description: "",
    tags: "clippings",
    content,
  };
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/markdown" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function fetchPageTitle(url) {
  try {
    const response = await fetch(`/api/title?url=${encodeURIComponent(url)}&t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    return data.title || "";
  } catch {
    return "";
  }
}

async function fillDerivedFields(url) {
  if (!elements.title.value.trim()) {
    setStatus("ページタイトルを取得しています...");
    const title = (await fetchPageTitle(url)) || deriveTitle(url);
    elements.title.value = title;
    setStatus(`取得タイトル: ${title}`);
  }
  if (!elements.author.value.trim()) elements.author.value = inferAuthor(url);
}

async function createMarkdown({ auto = false } = {}) {
  const clip = await getClipFromForm(auto);
  if (!clip) return;
  const { url, title, author, content } = clip;
  if (auto && url === lastDownloadedUrl) return;

  const markdown = buildMarkdown({ url, title, author, content });

  downloadText(`${safeFilename(title)}.md`, markdown);
  lastDownloadedUrl = url;
  setStatus("Markdownを作成しました。");
}

async function getClipFromForm(auto = false) {
  let url;
  try {
    url = normalizeUrl(elements.url.value);
  } catch {
    if (!auto) setStatus("URLを入力してください。");
    return null;
  }

  elements.url.value = url;
  await fillDerivedFields(url);

  return {
    url,
    title: elements.title.value.trim() || deriveTitle(url),
    author: elements.author.value.trim(),
    content: elements.content.value.trim(),
  };
}

async function sendToSheets() {
  const endpoint = elements.sheetsEndpoint.value.trim();
  if (!endpoint) {
    setStatus("Google Apps Script URLを入力してください。");
    return;
  }

  const clip = await getClipFromForm();
  if (!clip) return;

  setStatus("Sheetsへ送信しています...");
  try {
    const response = await fetch("/api/sheets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint,
        clip: buildClipPayload(clip),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "send failed");
    setStatus("Sheetsへ送信しました。");
  } catch {
    setStatus("Sheetsへ送信できませんでした。Apps Script URLを確認してください。");
  }
}

function focusUrlInput() {
  elements.url.focus();
  elements.url.select();
  setStatus("URL欄に貼り付けてください。貼り付けると自動でMarkdownを作成します。");
}

elements.url.addEventListener("paste", () => {
  elements.title.value = "";
  elements.author.value = "";
  window.setTimeout(() => createMarkdown({ auto: true }), 0);
});
elements.url.addEventListener("change", () => {
  elements.title.value = "";
  elements.author.value = "";
  createMarkdown({ auto: true });
});
elements.download.addEventListener("click", () => createMarkdown());
elements.pasteHelp.addEventListener("click", focusUrlInput);
elements.sendSheets.addEventListener("click", sendToSheets);
elements.sheetsEndpoint.addEventListener("input", () => {
  localStorage.setItem(sheetsEndpointStorageKey, elements.sheetsEndpoint.value.trim());
});
