const elements = {
  url: document.querySelector("#urlInput"),
  title: document.querySelector("#titleInput"),
  author: document.querySelector("#authorInput"),
  content: document.querySelector("#contentInput"),
  sheetsEndpoint: document.querySelector("#sheetsEndpointInput"),
  sheetUrl: document.querySelector("#sheetUrlInput"),
  pasteHelp: document.querySelector("#pasteHelpButton"),
  download: document.querySelector("#downloadButton"),
  sendSheets: document.querySelector("#sendSheetsButton"),
  openSheet: document.querySelector("#openSheetButton"),
  status: document.querySelector("#statusText"),
};

const sheetsEndpointStorageKey = "simple-web-clipper.sheets-endpoint";
const sheetUrlStorageKey = "simple-web-clipper.sheet-url";
const defaultSheetsEndpoint = "https://script.google.com/macros/s/AKfycbxb1kqPApIKDi-9xf0XDsrGWbbBu9fFEkrVTTk6ov_xbxIAaJGZy6l6sl81XUBXdrXR/exec";
const defaultSheetUrl = "https://docs.google.com/spreadsheets/d/1LgYhNoS5fJ8GjvSPTbpScQ05P0QKMBwJLsdPtklobUA/edit?gid=1315881697#gid=1315881697";
elements.sheetsEndpoint.value = localStorage.getItem(sheetsEndpointStorageKey) || defaultSheetsEndpoint;
elements.sheetUrl.value = localStorage.getItem(sheetUrlStorageKey) || defaultSheetUrl;
let lastSentUrl = "";
let triedStartupClipboard = false;

function setStatus(message) {
  elements.status.textContent = message;
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("empty");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  const removableParams = [
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "si",
    "spm",
  ];
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^utm_/i.test(key) || removableParams.includes(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

function getSite(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function inferTags(url) {
  const site = getSite(url);
  const rules = {
    "wwdjapan.com": ["fashion", "business"],
    "reskill.nikkei.com": ["business", "learning"],
    "nikkei.com": ["business"],
    "forbesjapan.com": ["business"],
    "billboard-japan.com": ["music"],
    "x.com": ["social"],
    "twitter.com": ["social"],
  };
  return ["clippings", ...(rules[site] || [])].join(",");
}

function deriveTitle(url) {
  const parsed = new URL(url);
  const lastPath = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!lastPath) return parsed.hostname.replace(/^www\./, "");
  return decodeURIComponent(lastPath).replace(/[-_]+/g, " ");
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s[-|｜–—‐-]\s*WWDJAPAN.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*最新ファッション.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*NIKKEIリスキリング.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*日経リスキリング.*$/i, "")
    .trim();
}

function looksDerivedTitle(title, url) {
  const derived = deriveTitle(url);
  const host = new URL(url).hostname.replace(/^www\./, "");
  return !title || title === derived || /^[A-Z0-9]{12,}$/i.test(title) || /^\d{5,}$/.test(title) || ["reskill.nikkei.com", "wwdjapan.com"].includes(host);
}

async function fetchReaderTitle(url) {
  try {
    const response = await fetch(`https://r.jina.ai/http://r.jina.ai/http://${url}`, {
      headers: { accept: "text/plain" },
      cache: "no-store",
    });
    const text = await response.text();
    const match = text.match(/^Title:\s*(.+)$/m);
    return cleanTitle(match?.[1] || "");
  } catch {
    return "";
  }
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

function buildMarkdown({ url, title, author, content, published = "", description = "" }) {
  const today = new Date().toISOString().slice(0, 10);
  const frontmatter = [
    "---",
    `title: ${yamlQuote(title)}`,
    `source: ${yamlQuote(url)}`,
    "author:",
    authorYaml(author),
    `published: ${published}`,
    `created: ${today}`,
    `description: ${description ? yamlQuote(description) : ""}`,
    "tags:",
    '  - "clippings"',
    "---",
  ].filter((line) => line !== "");

  return `${frontmatter.join("\n")}\n${content.trim() ? `${content.trim()}\n` : ""}`;
}

function buildClipPayload({ url, title, author, content }) {
  const created = new Date().toISOString().slice(0, 10);
  const normalizedUrl = normalizeUrl(url);
  return {
    title,
    source: normalizedUrl,
    url: normalizedUrl,
    canonical_source: normalizedUrl,
    site: getSite(normalizedUrl),
    status: "unread",
    author,
    published: "",
    created,
    description: "",
    tags: inferTags(normalizedUrl),
    content,
  };
}

function applyProvidedTitle(value) {
  const title = cleanTitle(value);
  if (title) elements.title.value = title;
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

async function fillDerivedFields(url) {
  if (!elements.title.value.trim()) {
    const title = deriveTitle(url);
    elements.title.value = title;
    setStatus(`URLを受け取りました: ${title}`);
  } else {
    elements.title.value = cleanTitle(elements.title.value);
  }
  if (looksDerivedTitle(elements.title.value.trim(), url)) {
    setStatus("タイトルを取得しています...");
    const title = await fetchReaderTitle(url);
    if (title) {
      elements.title.value = title;
      setStatus(`URLを受け取りました: ${title}`);
    }
  }
  if (!elements.author.value.trim()) elements.author.value = inferAuthor(url);
}

async function createMarkdown({ auto = false } = {}) {
  const clip = await getClipFromForm(auto);
  if (!clip) return;
  const { url, title, author, content } = clip;

  const markdown = buildMarkdown(clip);

  downloadText(`${safeFilename(title)}.md`, markdown);
  setStatus("Markdownを作成しました。");
}

async function prepareClipFromUrl({ auto = false } = {}) {
  const clip = await getClipFromForm(auto);
  if (!clip) return;
  if (clip.url === lastSentUrl) {
    setStatus("このURLは送信済みです。");
    return;
  }

  await sendClipToSheets(clip);
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
  const clip = await getClipFromForm();
  if (!clip) return;
  await sendClipToSheets(clip);
}

async function sendClipToSheets(clip) {
  const endpoint = elements.sheetsEndpoint.value.trim();
  if (!endpoint) {
    setStatus("Google Apps Script URLを入力してください。");
    return;
  }

  setStatus("Sheetsへ送信しています...");
  try {
    await fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        clip: buildClipPayload(clip),
      }),
    });
    lastSentUrl = clip.url;
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

function openSheet() {
  const url = elements.sheetUrl.value.trim();
  if (!url) {
    setStatus("Google Sheet URLを入力してください。");
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

async function importClipboardOnStartup() {
  if (triedStartupClipboard || !navigator.clipboard?.readText) return;
  triedStartupClipboard = true;

  try {
    const text = await navigator.clipboard.readText();
    const url = normalizeUrl(text);
    elements.url.value = url;
    elements.title.value = "";
    elements.author.value = "";
    await prepareClipFromUrl({ auto: true });
  } catch {
    setStatus("クリップボード自動読込はブロックされました。URL欄に貼り付けてください。");
  }
}

async function importUrlFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const pathValue = decodeURIComponent(window.location.pathname.slice(1));
  const rawUrl = params.get("url") || (pathValue.startsWith("http") ? pathValue : "");
  const rawTitle = params.get("title") || "";
  if (!rawUrl) return false;

  try {
    const url = normalizeUrl(rawUrl);
    elements.url.value = url;
    elements.title.value = "";
    elements.author.value = "";
    applyProvidedTitle(rawTitle);
    await prepareClipFromUrl({ auto: true });
    window.history.replaceState({}, "", window.location.pathname);
    return true;
  } catch {
    setStatus("ショートカットから渡されたURLを読み取れませんでした。");
    return false;
  }
}

elements.url.addEventListener("paste", () => {
  elements.title.value = "";
  elements.author.value = "";
  window.setTimeout(() => prepareClipFromUrl({ auto: true }), 0);
});
elements.url.addEventListener("change", () => {
  elements.title.value = "";
  elements.author.value = "";
  prepareClipFromUrl({ auto: true });
});
elements.download.addEventListener("click", () => createMarkdown());
elements.pasteHelp.addEventListener("click", focusUrlInput);
elements.sendSheets.addEventListener("click", sendToSheets);
elements.openSheet.addEventListener("click", openSheet);
elements.sheetsEndpoint.addEventListener("input", () => {
  localStorage.setItem(sheetsEndpointStorageKey, elements.sheetsEndpoint.value.trim());
});
elements.sheetUrl.addEventListener("input", () => {
  localStorage.setItem(sheetUrlStorageKey, elements.sheetUrl.value.trim());
});
window.addEventListener("load", async () => {
  const imported = await importUrlFromQuery();
  if (!imported) await importClipboardOnStartup();
});
