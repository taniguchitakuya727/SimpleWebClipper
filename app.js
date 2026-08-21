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
  loadList: document.querySelector("#loadListButton"),
  openSheet: document.querySelector("#openSheetButton"),
  search: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  clipList: document.querySelector("#clipList"),
  status: document.querySelector("#statusText"),
};

const sheetsEndpointStorageKey = "simple-web-clipper.sheets-endpoint";
const sheetUrlStorageKey = "simple-web-clipper.sheet-url";
const defaultSheetsEndpoint = "https://script.google.com/macros/s/AKfycbxb1kqPApIKDi-9xf0XDsrGWbbBu9fFEkrVTTk6ov_xbxIAaJGZy6l6sl81XUBXdrXR/exec";
const defaultSheetUrl = "https://docs.google.com/spreadsheets/d/1LgYhNoS5fJ8GjvSPTbpScQ05P0QKMBwJLsdPtklobUA/edit?gid=1315881697#gid=1315881697";
const xArticleTitleOverrides = {
  "2046592455903219940": "Claude × Obsidian × Codex 最強の共通セカンドブレイン完全構築ガイド",
  "2046537548819054592": "Claude × Obsidian × Codex 最強の共通セカンドブレイン完全構築ガイド",
  "2055590945123704833": "Claude × Obsidian × Codex 最強の共通セカンドブレイン完全構築ガイド",
};
elements.sheetsEndpoint.value = localStorage.getItem(sheetsEndpointStorageKey) || defaultSheetsEndpoint;
elements.sheetUrl.value = localStorage.getItem(sheetUrlStorageKey) || defaultSheetUrl;
let lastSentUrl = "";
let triedStartupClipboard = false;
let clips = [];

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
    "ref_src",
    "si",
    "spm",
  ];
  for (const key of [...parsed.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    const isSocialNoise = ["x.com", "twitter.com"].includes(parsed.hostname.replace(/^www\./, "")) && ["s", "t"].includes(normalizedKey);
    if (/^utm_/i.test(key) || removableParams.includes(normalizedKey) || isSocialNoise) parsed.searchParams.delete(key);
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
    "lifehacker.jp": ["productivity", "business"],
    "wired.jp": ["technology", "culture"],
    "billboard-japan.com": ["music"],
    "weld-music.com": ["music", "blog"],
    "youtube.com": ["video"],
    "youtu.be": ["video"],
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
    .replace(/\s[-|｜–—‐-]\s*WELD MUSIC.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*ライフハッカー・ジャパン.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*WIRED\.jp.*$/i, "")
    .trim();
}

function looksDerivedTitle(title, url) {
  const derived = deriveTitle(url);
  const host = new URL(url).hostname.replace(/^www\./, "");
  return !title || title === derived || shouldPreferMetadataTitle(host) || isBadXTitle(title, url) || /^[A-Z0-9_-]{8,}$/i.test(title) || /^\d{5,}$/.test(title);
}

function shouldPreferMetadataTitle(host) {
  return ["lifehacker.jp", "reskill.nikkei.com", "wwdjapan.com", "weld-music.com", "wired.jp", "youtube.com", "youtu.be", "x.com", "twitter.com"].includes(host);
}

function isBadXTitle(title, url) {
  if (!isXUrl(url)) return false;
  return /^Xユーザーの.+https:\/\/t\.co\/[A-Za-z0-9]+.*\/ X$/.test(title) || /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(title);
}

async function fetchReaderTitle(url) {
  try {
    const sheetsTitle = await fetchSheetsMetadataTitle(url);
    if (sheetsTitle) return sheetsTitle;

    const youtubeTitle = await fetchYoutubeTitle(url);
    if (youtubeTitle) return youtubeTitle;

    const xTitle = await fetchXTitle(url);
    if (xTitle) return xTitle;

    const weldTitle = await fetchWeldTitle(url);
    if (weldTitle) return weldTitle;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 7000);
    const response = await fetch(buildReaderUrl(url), {
      headers: { accept: "text/plain" },
      cache: "no-store",
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    const text = await response.text();
    const match = text.match(/^Title:\s*(.+)$/m);
    const title = cleanTitle(match?.[1] || "");
    return isGoodTitle(title) ? title : "";
  } catch {
    return "";
  }
}

function buildReaderUrl(url) {
  const parsed = new URL(url);
  return `https://r.jina.ai/http://r.jina.ai/http://${parsed.host}${parsed.pathname}${parsed.search}`;
}

async function fetchSheetsMetadataTitle(url) {
  const endpoint = elements.sheetsEndpoint.value.trim();
  if (!endpoint) return "";

  try {
    const data = await jsonp(`${endpoint}?url=${encodeURIComponent(url)}`);
    const title = cleanTitle(data?.metadata?.title || "");
    return isGoodTitle(title) ? title : "";
  } catch {
    return "";
  }
}

async function fetchYoutubeTitle(url) {
  if (!isYoutubeUrl(url)) return "";
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      cache: "no-store",
    });
    const data = await response.json();
    return cleanTitle(data.title || "");
  } catch {
    return "";
  }
}

function isYoutubeUrl(url) {
  const site = getSite(url);
  return site === "youtube.com" || site === "youtu.be";
}

async function fetchXTitle(url) {
  if (!isXUrl(url)) return "";
  const directTitle = getXTitleOverride(url);
  if (directTitle) return directTitle;

  try {
    const response = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`, {
      cache: "no-store",
    });
    const data = await response.json();
    const text = htmlToText(data.html || "");
    const body = text.split("—")[0]?.trim() || "";
    const articleTitle = await fetchXArticleTitle(body);
    if (articleTitle) return articleTitle;
    if (/^https:\/\/t\.co\/[A-Za-z0-9]+$/i.test(body)) return cleanTitle(`${data.author_name}: X Article`);
    return cleanTitle([data.author_name, body].filter(Boolean).join(": "));
  } catch {
    return "";
  }
}

function getXTitleOverride(url) {
  const id = String(url).match(/\/(?:status|article)\/(\d+)/)?.[1] || String(url).match(/\/i\/article\/(\d+)/)?.[1];
  return cleanTitle(xArticleTitleOverrides[id] || "");
}

async function fetchXArticleTitle(text) {
  const tcoUrl = text.match(/https:\/\/t\.co\/[A-Za-z0-9]+/i)?.[0];
  if (!tcoUrl) return "";

  try {
    const response = await fetch(tcoUrl, {
      cache: "no-store",
      redirect: "follow",
    });
    const articleId = response.url.match(/\/i\/article\/(\d+)/)?.[1];
    return cleanTitle(xArticleTitleOverrides[articleId] || "");
  } catch {
    return "";
  }
}

function isXUrl(url) {
  const site = getSite(url);
  return site === "x.com" || site === "twitter.com";
}

function htmlToText(html) {
  const node = document.createElement("div");
  node.innerHTML = html;
  return node.textContent.replace(/\s+/g, " ").trim();
}

function isGoodTitle(value) {
  if (!value || value.length < 4) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/doubleclick|pixel|request could not be satisfied|access denied|not found/i.test(value)) return false;
  return true;
}

async function fetchWeldTitle(url) {
  const match = url.match(/^https?:\/\/(?:www\.)?weld-music\.com\/[^/?#]+\/(\d+)/i);
  if (!match) return "";
  try {
    const response = await fetch(`https://weld-music.com/wp-json/wp/v2/posts/${match[1]}?_fields=title`, {
      cache: "no-store",
    });
    const data = await response.json();
    return cleanTitle(data.title?.rendered || "");
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

function applyProvidedTitle(value, url = "") {
  const title = cleanTitle(value);
  if (title && !isBadXTitle(title, url)) elements.title.value = title;
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

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callback = `simpleWebClipperCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("jsonp timeout"));
    }, 5000);
    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}callback=${callback}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("jsonp failed"));
    };
    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };
    function cleanup() {
      window.clearTimeout(timeoutId);
      delete window[callback];
      script.remove();
    }
    document.body.appendChild(script);
  });
}

async function loadClipList() {
  const endpoint = elements.sheetsEndpoint.value.trim();
  if (!endpoint) {
    setStatus("Google Apps Script URLを入力してください。");
    return;
  }

  setStatus("リストを読み込んでいます...");
  try {
    const data = await jsonp(`${endpoint}?list=1&limit=300`);
    clips = Array.isArray(data.clips) ? data.clips : [];
    renderClipList();
    setStatus(`${clips.length}件を読み込みました。`);
  } catch {
    setStatus("リストを読み込めませんでした。Apps Scriptを最新版に再デプロイしてください。");
  }
}

function renderClipList() {
  const query = elements.search.value.trim().toLowerCase();
  const status = elements.statusFilter.value;
  const filtered = clips.filter((clip) => {
    const haystack = [clip.title, clip.source, clip.site, clip.tags, clip.description, clip.author].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!status || clip.status === status);
  });

  elements.clipList.textContent = "";
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = clips.length ? "一致するクリップはありません。" : "まだ読み込まれていません。";
    elements.clipList.appendChild(empty);
    return;
  }

  for (const clip of filtered) {
    const item = document.createElement("article");
    item.className = "clip-item";

    const title = document.createElement("a");
    title.className = "clip-title";
    title.href = clip.source || clip.canonical_source || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = clip.title || clip.source || "untitled";

    const meta = document.createElement("div");
    meta.className = "clip-meta";
    meta.textContent = [clip.site, clip.status, clip.tags, clip.created || clip.timestamp].filter(Boolean).join(" / ");

    const description = document.createElement("p");
    description.className = "clip-description";
    description.textContent = clip.description || clip.source || "";

    item.append(title, meta, description);
    elements.clipList.appendChild(item);
  }
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
    applyProvidedTitle(rawTitle, url);
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
elements.loadList.addEventListener("click", loadClipList);
elements.openSheet.addEventListener("click", openSheet);
elements.search.addEventListener("input", renderClipList);
elements.statusFilter.addEventListener("change", renderClipList);
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
