const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 4173);
const root = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function send(response, status, body, type = "text/plain; charset=utf-8", headers = {}) {
  response.writeHead(status, { "content-type": type, ...headers });
  response.end(body);
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
  const pattern = new RegExp(`${name}\\\\s*=\\\\s*([\"'])(.*?)\\\\1`, "i");
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
  const metaTitle = getNamedMetaContent(html, "twitter:title") || getMetaContent(html, ["twitter:title", "og:title"]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return decodeHtml(stripTags(metaTitle || title?.[1] || h1?.[1] || "").replace(/\s+/g, " ").trim());
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

async function handleTitle(request, response) {
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
        "user-agent": "SimpleWebClipper/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const bytes = new Uint8Array(await page.arrayBuffer());
    const html = decodePage(page.headers, bytes);
    send(response, 200, JSON.stringify({ title: pickTitle(html) }), "application/json; charset=utf-8", { "cache-control": "no-store" });
  } catch (error) {
    send(response, 200, JSON.stringify({ title: "" }), "application/json; charset=utf-8", { "cache-control": "no-store" });
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
      send(response, 404, "Not found");
      return;
    }

    send(response, 200, data, types[path.extname(filePath)] || "application/octet-stream", { "cache-control": "no-store" });
  });
}

http
  .createServer((request, response) => {
    if (request.url.startsWith("/api/title")) {
      handleTitle(request, response);
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
  });
