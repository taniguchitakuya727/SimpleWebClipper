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
    matchFirst(html, /<h1[^>]+class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i),
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
    .trim();
}

function isGoodTitle(value) {
  if (!value || value.length < 4) return false;
  if (/ERROR:|request could not be satisfied|access denied|not found/i.test(value)) return false;
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

    const page = await fetch(parsed.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const bytes = new Uint8Array(await page.arrayBuffer());
    const html = decodePage(page.headers, bytes);
    send(response, 200, JSON.stringify(pickMetadata(html)), "application/json; charset=utf-8", { "cache-control": "no-store" });
  } catch (error) {
    send(response, 200, JSON.stringify({ title: "", published: "", description: "" }), "application/json; charset=utf-8", { "cache-control": "no-store" });
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
