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
        "User-Agent": "SimpleWebClipper/1.0",
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
  return cleanHtml(getNamedMeta(html, "twitter:title") || getMeta(html, ["twitter:title", "og:title"]) || matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || matchFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
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
