const SHEET_NAME = "clips";
const HEADERS = ["timestamp", "title", "source", "author", "published", "created", "description", "tags", "content"];

function doPost(e) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  const request = JSON.parse(e.postData.contents);
  const clip = enrichClip(request.clip || request);
  ensureHeader(sheet);
  const row = [
    new Date(),
    clip.title || "",
    clip.source || clip.url || "",
    clip.author || "",
    clip.published || "",
    clip.created || "",
    clip.description || "",
    clip.tags || "clippings",
    clip.content || "",
  ];
  const rowNumber = findRowBySource(sheet, clip.source || clip.url || "");
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, updated: Boolean(rowNumber) })).setMimeType(ContentService.MimeType.JSON);
}

function enrichClip(clip) {
  const source = clip.source || clip.url || "";
  const metadata = source ? fetchMetadata(source) : {};
  return {
    title: metadata.title || clip.title || source,
    source,
    url: source,
    author: clip.author || "",
    published: metadata.published || clip.published || "",
    created: clip.created || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
    description: metadata.description || clip.description || "",
    tags: clip.tags || "clippings",
    content: clip.content || "",
  };
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(HEADERS);
}

function findRowBySource(sheet, source) {
  if (!source || sheet.getLastRow() < 2) return 0;
  const sources = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues();
  const index = sources.findIndex((row) => row[0] === source);
  return index >= 0 ? index + 2 : 0;
}

function fetchMetadata(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = response.getContentText();
    return {
      title: pickTitle(html),
      published: pickPublished(html),
      description: pickDescription(html),
    };
  } catch (error) {
    return {};
  }
}

function pickTitle(html) {
  const candidates = [
    getJsonLdValue(html, "headline"),
    matchFirst(html, /<h1[^>]+class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i),
    getMeta(html, ["og:title", "twitter:title"]),
    matchFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
  ];
  for (const candidate of candidates) {
    const title = cleanTitle(cleanHtml(candidate));
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

function pickDescription(html) {
  return cleanHtml(getMeta(html, ["description", "og:description", "twitter:description"]));
}

function pickPublished(html) {
  const value =
    getMeta(html, ["article:published_time", "datepublished", "date", "dc.date", "dc.date.issued", "pubdate", "publishdate", "published"]) ||
    matchFirst(html, /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i) ||
    matchFirst(html, /<p[^>]+class=["'][^"']*\btime\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  return normalizeDate(value);
}

function getMeta(html, names) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const name of names) {
    for (const tag of tags) {
      const key = getAttr(tag, "property") || getAttr(tag, "name");
      if (key.toLowerCase() === name) return getAttr(tag, "content");
    }
  }
  return "";
}

function getNamedMeta(html, name) {
  return getMeta(html, [name]);
}

function getAttr(tag, name) {
  const pattern = new RegExp(name + "\\s*=\\s*([\"'])(.*?)\\1", "i");
  const match = tag.match(pattern);
  return match ? match[2] : "";
}

function matchFirst(value, pattern) {
  const match = value.match(pattern);
  return match ? match[1] : "";
}

function getJsonLdValue(html, key) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const pattern = new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"', "i");
  for (const script of scripts) {
    const match = script.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}

function cleanHtml(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#([0-9]+);/g, function (_, code) {
      return String.fromCharCode(Number(code));
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeDate(value) {
  const normalized = cleanHtml(value);
  if (!normalized) return "";
  const slashDate = normalized.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (slashDate) return slashDate[1] + "-" + slashDate[2].padStart(2, "0") + "-" + slashDate[3].padStart(2, "0");

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.valueOf())) return Utilities.formatDate(parsed, "UTC", "yyyy-MM-dd");
  return normalized;
}
