const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 4173);
const root = __dirname;
loadEnvFile();
const clipperPassword = process.env.CLIPPER_PASSWORD || "";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function send(response, status, body, type = "text/plain; charset=utf-8", headers = {}) {
  response.writeHead(status, { "content-type": type, ...headers });
  response.end(body);
}

function isAuthorized(request) {
  if (!clipperPassword) return true;

  const authorization = request.headers.authorization || "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const password = decoded.split(":").slice(1).join(":");
  return password === clipperPassword;
}

function requireAuth(response) {
  send(response, 401, "Authentication required", "text/plain; charset=utf-8", {
    "www-authenticate": 'Basic realm="Simple Web Clipper"',
    "cache-control": "no-store",
  });
}

function loadEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return tag.match(pattern)?.[2] || "";
}

function getMetaContent(html, names) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const name of names) {
    for (const tag of metaTags) {
      const key = getAttribute(tag, "property") || getAttribute(tag, "name");
      if (key.toLowerCase() === name) return getAttribute(tag, "content");
    }
  }
  return "";
}

function getNamedMetaContent(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escapedName}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapedName}["']`, "i"),
    new RegExp(`<meta[^>]+property=["']${escapedName}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapedName}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "");
}

function pickTitle(html) {
  const candidates = [
    getJsonLdValue(html, "headline"),
    matchFirst(html, /<h[1-3][^>]+class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-3]>/i),
    matchFirst(html, /<h1[^>]+class=["'][^"']*\barticle_[^"']*Title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i),
    getMetaContent(html, ["cxenseparse:title", "cXenseParse:title"]),
    getMetaContent(html, ["og:title", "twitter:title"]),
    matchFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
  ];
  for (const candidate of candidates) {
    const title = cleanTitle(decodeHtml(stripTags(candidate).replace(/\s+/g, " ").trim()));
    if (isGoodTitle(title)) return title;
  }
  return "";
}

function cleanTitle(value) {
  return value
    .replace(/\s[-|｜–—‐-]\s*WWDJAPAN.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*最新ファッション.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*NIKKEIリスキリング.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*日経リスキリング.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*WELD MUSIC.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*ライフハッカー・ジャパン.*$/i, "")
    .replace(/\s[-|｜–—‐-]\s*WIRED\.jp.*$/i, "")
    .trim();
}

function isGoodTitle(value) {
  if (!value || value.length < 4) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/ERROR:|doubleclick|pixel|request could not be satisfied|access denied|not found/i.test(value)) return false;
  return true;
}

function matchFirst(value, pattern) {
  const match = value.match(pattern);
  return match?.[1] || "";
}

function getJsonLdValue(html, key) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "i");
  for (const script of scripts) {
    const match = script.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function pickDescription(html) {
  const description = getMetaContent(html, ["description", "og:description", "twitter:description"]);
  return decodeHtml(stripTags(description).replace(/\s+/g, " ").trim());
}

function normalizeDate(value) {
  if (!value) return "";
  const normalized = decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();
  const slashDate = normalized.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (slashDate) return `${slashDate[1]}-${slashDate[2].padStart(2, "0")}-${slashDate[3].padStart(2, "0")}`;

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return normalized;
}

function pickPublished(html) {
  const metaDate = getMetaContent(html, [
    "article:published_time",
    "datepublished",
    "date",
    "dc.date",
    "dc.date.issued",
    "pubdate",
    "publishdate",
    "published",
  ]);
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i)?.[1];
  const billboardTime = html.match(/<p[^>]+class=["'][^"']*\btime\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  return normalizeDate(metaDate || time || billboardTime);
}

function pickMetadata(html) {
  return {
    title: pickTitle(html),
    published: pickPublished(html),
    description: pickDescription(html),
  };
}

function detectEncoding(headers, bytes) {
  const contentType = headers.get("content-type") || "";
  const headerCharset = contentType.match(/charset=([^;\s]+)/i)?.[1];
  if (headerCharset) return headerCharset.toLowerCase();

  const preview = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 4096));
  return preview.match(/charset=["']?([^"'\s/>]+)/i)?.[1]?.toLowerCase() || "utf-8";
}

function decodePage(headers, bytes) {
  const encoding = detectEncoding(headers, bytes);
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function handleMetadata(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    send(response, 400, JSON.stringify({ error: "url is required" }), "application/json; charset=utf-8");
    return;
  }

  try {
    const parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");

    const youtubeMetadata = await fetchYoutubeMetadata(parsed.toString());
    if (youtubeMetadata.title) {
      send(response, 200, JSON.stringify(youtubeMetadata), "application/json; charset=utf-8", { "cache-control": "no-store" });
      return;
    }

    const xMetadata = await fetchXMetadata(parsed.toString());
    if (xMetadata.title) {
      send(response, 200, JSON.stringify(xMetadata), "application/json; charset=utf-8", { "cache-control": "no-store" });
      return;
    }

    const weldMetadata = await fetchWeldMetadata(parsed.toString());
    if (weldMetadata.title) {
      send(response, 200, JSON.stringify(weldMetadata), "application/json; charset=utf-8", { "cache-control": "no-store" });
      return;
    }

    const wwdMetadata = await fetchWwdMetadata(parsed.toString());
    if (wwdMetadata.title) {
      send(response, 200, JSON.stringify(wwdMetadata), "application/json; charset=utf-8", { "cache-control": "no-store" });
      return;
    }

    const page = await fetch(parsed.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const bytes = new Uint8Array(await page.arrayBuffer());
    const html = decodePage(page.headers, bytes);
    const metadata = pickMetadata(html);
    send(response, 200, JSON.stringify(metadata.title ? metadata : await fetchReaderMetadata(parsed.toString())), "application/json; charset=utf-8", { "cache-control": "no-store" });
  } catch (error) {
    send(response, 200, JSON.stringify(await fetchReaderMetadata(target)), "application/json; charset=utf-8", { "cache-control": "no-store" });
  }
}

async function fetchYoutubeMetadata(url) {
  if (!isYoutubeUrl(url)) return {};

  try {
    const api = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
      },
    });
    const data = await api.json();
    return {
      title: cleanTitle(data.title || ""),
      published: "",
      description: data.author_name || "",
    };
  } catch {
    return {};
  }
}

function isYoutubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

async function fetchXMetadata(url) {
  if (!isXUrl(url)) return {};

  try {
    const api = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
      },
    });
    const data = await api.json();
    const text = decodeHtml(stripTags(data.html || "").replace(/\s+/g, " ").trim());
    const body = (text.split("—")[0] || "").trim();
    return {
      title: cleanTitle([data.author_name, body].filter(Boolean).join(": ")),
      published: "",
      description: data.author_url || "",
    };
  } catch {
    return {};
  }
}

function isXUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "x.com" || host === "twitter.com";
  } catch {
    return false;
  }
}

async function fetchWeldMetadata(url) {
  const match = url.match(/^https?:\/\/(?:www\.)?weld-music\.com\/[^/?#]+\/(\d+)/i);
  if (!match) return {};

  try {
    const api = await fetch(`https://weld-music.com/wp-json/wp/v2/posts/${match[1]}?_fields=title,date,excerpt`, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
      },
    });
    const data = await api.json();
    return {
      title: cleanTitle(decodeHtml(stripTags(data.title?.rendered || "").replace(/\s+/g, " ").trim())),
      published: normalizeDate(data.date || ""),
      description: decodeHtml(stripTags(data.excerpt?.rendered || "").replace(/\s+/g, " ").trim()),
    };
  } catch {
    return {};
  }
}

async function fetchWwdMetadata(url) {
  const match = url.match(/^https?:\/\/(?:www\.)?wwdjapan\.com\/articles\/(\d+)/i);
  if (!match) return {};

  try {
    const api = await fetch(`https://www.wwdjapan.com/wp-json/wp/v2/posts/${match[1]}?_fields=title,date,excerpt`, {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        accept: "application/json,text/html",
      },
    });
    const data = await api.json();
    return {
      title: cleanTitle(decodeHtml(stripTags(data.title?.rendered || "").replace(/\s+/g, " ").trim())),
      published: normalizeDate(data.date || ""),
      description: decodeHtml(stripTags(data.excerpt?.rendered || "").replace(/\s+/g, " ").trim()),
    };
  } catch {
    return {};
  }
}

async function fetchReaderMetadata(url) {
  try {
    const reader = await fetch(`https://r.jina.ai/http://r.jina.ai/http://${url}`, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/plain",
      },
    });
    const text = await reader.text();
    const title = cleanTitle(decodeHtml(stripTags(matchFirst(text, /^Title:\s*(.+)$/m)).replace(/\s+/g, " ").trim()));
    return {
      title: isGoodTitle(title) ? title : "",
      published: normalizeDate(matchFirst(text, /^Published Time:\s*(.+)$/m)),
      description: decodeHtml(stripTags(matchFirst(text, /^Markdown Content:\s*[\r\n]+([\s\S]{0,500})/m)).replace(/\s+/g, " ").trim()),
    };
  } catch {
    return { title: "", published: "", description: "" };
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function handleSheets(request, response) {
  if (request.method !== "POST") {
    send(response, 405, JSON.stringify({ ok: false, error: "method not allowed" }), "application/json; charset=utf-8");
    return;
  }

  try {
    const { endpoint, clip } = await readJson(request);
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") throw new Error("endpoint must be https");

    const sheetsResponse = await fetch(parsed.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(clip),
    });
    const text = await sheetsResponse.text();
    send(response, sheetsResponse.ok ? 200 : 502, text || JSON.stringify({ ok: sheetsResponse.ok }), "application/json; charset=utf-8", {
      "cache-control": "no-store",
    });
  } catch (error) {
    send(response, 400, JSON.stringify({ ok: false, error: error.message }), "application/json; charset=utf-8", { "cache-control": "no-store" });
  }
}

function handleStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      const extension = path.extname(filePath);
      if (["GET", "HEAD"].includes(request.method) && !types[extension]) {
        fs.readFile(path.join(root, "index.html"), (indexError, indexData) => {
          if (indexError) send(response, 404, "Not found");
          else send(response, 200, indexData, types[".html"], { "cache-control": "no-store" });
        });
        return;
      }

      send(response, 404, "Not found");
      return;
    }

    send(response, 200, data, types[path.extname(filePath)] || "application/octet-stream", { "cache-control": "no-store" });
  });
}

http
  .createServer((request, response) => {
    if (!isAuthorized(request)) {
      requireAuth(response);
      return;
    }

    if (request.url.startsWith("/api/title") || request.url.startsWith("/api/metadata")) {
      handleMetadata(request, response);
      return;
    }
    if (request.url.startsWith("/api/sheets")) {
      handleSheets(request, response);
      return;
    }

    handleStatic(request, response);
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`Simple Web Clipper: http://localhost:${port}/`);
    if (clipperPassword) console.log("Basic auth: enabled");
  });
