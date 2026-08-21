const SHEET_NAME = "clips";
const HEADERS = ["timestamp", "title", "source", "site", "status", "author", "published", "created", "description", "tags", "content", "canonical_source"];
const SCRIPT_VERSION = "2026-08-20-x-article-title";
const X_ARTICLE_TITLE_OVERRIDES = {
  "2046592455903219940": "Claude × Obsidian × Codex 最強の共通セカンドブレイン完全構築ガイド",
  "2046537548819054592": "Claude × Obsidian × Codex 最強の共通セカンドブレイン完全構築ガイド",
  "2055590945123704833": "Claude × Obsidian × Codex 最強の共通セカンドブレイン完全構築ガイド",
};

function doGet(e) {
  const url = e && e.parameter && e.parameter.url;
  const output = e && e.parameter && e.parameter.list
    ? { ok: true, version: SCRIPT_VERSION, clips: listClips(Number(e.parameter.limit || 200)) }
    : url
      ? { ok: true, version: SCRIPT_VERSION, metadata: fetchMetadata(url) }
      : { ok: true, version: SCRIPT_VERSION };
  return jsonOutput(output, e && e.parameter && e.parameter.callback);
}

function doPost(e) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  const request = JSON.parse(e.postData.contents);
  const clip = enrichClip(request.clip || request);
  const headerMap = ensureHeader(sheet);
  const rowValues = buildRowValues(headerMap, clip);
  const rowNumber = findRowBySource(sheet, clip.canonical_source || clip.source || clip.url || "", headerMap);
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, updated: Boolean(rowNumber) })).setMimeType(ContentService.MimeType.JSON);
}

function jsonOutput(value, callback) {
  const json = JSON.stringify(value);
  const safeCallback = /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback || "") ? callback : "";
  const body = safeCallback ? safeCallback + "(" + json + ")" : json;
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function listClips(limit) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  const headerMap = ensureHeader(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rowCount = Math.min(Math.max(limit || 200, 1), lastRow - 1);
  const startRow = Math.max(2, lastRow - rowCount + 1);
  const rows = sheet.getRange(startRow, 1, rowCount, sheet.getLastColumn()).getValues();
  return rows.reverse().map(function (row) {
    return {
      timestamp: getCell(row, headerMap.timestamp),
      title: getCell(row, headerMap.title),
      source: getCell(row, headerMap.source),
      site: getCell(row, headerMap.site),
      status: getCell(row, headerMap.status),
      author: getCell(row, headerMap.author),
      published: getCell(row, headerMap.published),
      created: getCell(row, headerMap.created),
      description: getCell(row, headerMap.description),
      tags: getCell(row, headerMap.tags),
      content: getCell(row, headerMap.content),
      canonical_source: getCell(row, headerMap.canonical_source),
    };
  });
}

function getCell(row, column) {
  const value = column ? row[column - 1] : "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }
  return value || "";
}

function enrichClip(clip) {
  const source = normalizeUrl(clip.source || clip.url || "");
  const metadata = source ? fetchMetadata(source) : {};
  return {
    title: metadata.title || clip.title || source,
    source,
    url: source,
    canonical_source: normalizeUrl(clip.canonical_source || source),
    site: clip.site || getSite(source),
    status: clip.status || "unread",
    author: clip.author || "",
    published: metadata.published || clip.published || "",
    created: clip.created || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
    description: metadata.description || clip.description || "",
    tags: mergeTags(clip.tags, inferTags(source)),
    content: clip.content || "",
  };
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    return getHeaderMap(sheet);
  }

  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].filter(String);
  const missing = HEADERS.filter((header) => existing.indexOf(header) < 0);
  if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  return getHeaderMap(sheet);
}

function getHeaderMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function (header, index) {
    if (header) map[header] = index + 1;
  });
  return map;
}

function buildRowValues(headerMap, clip) {
  const row = new Array(Object.keys(headerMap).length).fill("");
  const values = {
    timestamp: new Date(),
    title: clip.title || "",
    source: clip.source || clip.url || "",
    site: clip.site || "",
    status: clip.status || "unread",
    author: clip.author || "",
    published: clip.published || "",
    created: clip.created || "",
    description: clip.description || "",
    tags: clip.tags || "clippings",
    content: clip.content || "",
    canonical_source: clip.canonical_source || clip.source || clip.url || "",
  };
  Object.keys(values).forEach(function (key) {
    if (headerMap[key]) row[headerMap[key] - 1] = values[key];
  });
  return row;
}

function findRowBySource(sheet, source, headerMap) {
  if (!source || sheet.getLastRow() < 2) return 0;
  const canonicalColumn = headerMap.canonical_source || headerMap.source;
  const sources = sheet.getRange(2, canonicalColumn, sheet.getLastRow() - 1, 1).getValues();
  const normalized = normalizeUrl(source);
  const index = sources.findIndex(function (row) {
    return normalizeUrl(row[0]) === normalized;
  });
  return index >= 0 ? index + 2 : 0;
}

function normalizeUrl(value) {
  if (!value) return "";
  const removableParams = ["fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref_src", "si", "spm"];
  const withoutHash = String(value).replace(/#.*$/, "");
  const parts = withoutHash.split("?");
  const base = parts[0].replace(/([^:])\/+$/, "$1");
  const site = getSite(base);
  if (!parts[1]) return base;

  const params = parts[1]
    .split("&")
    .filter(function (pair) {
      const key = safeDecodeURIComponent(pair.split("=")[0] || "").toLowerCase();
      const isSocialNoise = (site === "x.com" || site === "twitter.com") && (key === "s" || key === "t");
      return key && !/^utm_/i.test(key) && removableParams.indexOf(key) < 0 && !isSocialNoise;
    });
  return params.length ? base + "?" + params.join("&") : base;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function getSite(url) {
  const match = String(url || "").match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
  return match ? match[1] : "";
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
  return ["clippings"].concat(rules[site] || []);
}

function mergeTags(existing, inferred) {
  const tags = String(existing || "")
    .split(",")
    .concat(inferred || [])
    .map(function (tag) {
      return tag.trim();
    })
    .filter(Boolean);
  return Array.from(new Set(tags)).join(",");
}

function fetchMetadata(url) {
  try {
    const youtubeMetadata = fetchYoutubeMetadata(url);
    if (youtubeMetadata.title) return youtubeMetadata;

    const xMetadata = fetchXMetadata(url);
    if (xMetadata.title) return xMetadata;

    const weldMetadata = fetchWeldMetadata(url);
    if (weldMetadata.title) return weldMetadata;

    const wwdMetadata = fetchWwdMetadata(url);
    if (wwdMetadata.title) return wwdMetadata;

    const response = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = response.getContentText();
    const metadata = {
      title: pickTitle(html),
      published: pickPublished(html),
      description: pickDescription(html),
    };
    if (metadata.title) return metadata;

    return fetchReaderMetadata(url);
  } catch (error) {
    return fetchReaderMetadata(url);
  }
}

function fetchYoutubeMetadata(url) {
  if (!isYoutubeUrl(url)) return {};

  try {
    const response = UrlFetchApp.fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent(url) + "&format=json", {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    const data = JSON.parse(response.getContentText());
    return {
      title: cleanTitle(data.title || ""),
      published: "",
      description: data.author_name || "",
    };
  } catch (error) {
    return {};
  }
}

function isYoutubeUrl(url) {
  const site = getSite(url);
  return site === "youtube.com" || site === "youtu.be";
}

function fetchXMetadata(url) {
  if (!isXUrl(url)) return {};
  const directTitle = getXTitleOverride(url);
  if (directTitle) {
    return {
      title: directTitle,
      published: "",
      description: "",
    };
  }

  try {
    const response = UrlFetchApp.fetch("https://publish.twitter.com/oembed?url=" + encodeURIComponent(url), {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    const data = JSON.parse(response.getContentText());
    const text = cleanHtml(data.html || "");
    const body = (text.split("—")[0] || "").trim();
    const articleTitle = fetchXArticleTitle(body);
    return {
      title: articleTitle || fetchXFallbackTitle(data.author_name, body),
      published: "",
      description: data.author_url || "",
    };
  } catch (error) {
    return {};
  }
}

function isXUrl(url) {
  const site = getSite(url);
  return site === "x.com" || site === "twitter.com";
}

function getXTitleOverride(url) {
  const match = String(url || "").match(/\/(?:status|article)\/(\d+)/) || String(url || "").match(/\/i\/article\/(\d+)/);
  return match ? cleanTitle(X_ARTICLE_TITLE_OVERRIDES[match[1]] || "") : "";
}

function fetchXArticleTitle(text) {
  const match = String(text || "").match(/https:\/\/t\.co\/[A-Za-z0-9]+/i);
  if (!match) return "";

  try {
    const response = UrlFetchApp.fetch(match[0], {
      followRedirects: false,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    const headers = response.getAllHeaders();
    const location = headers.Location || headers.location || "";
    const articleId = String(location).match(/\/i\/article\/(\d+)/);
    return articleId ? cleanTitle(X_ARTICLE_TITLE_OVERRIDES[articleId[1]] || "") : "";
  } catch (error) {
    return "";
  }
}

function fetchXFallbackTitle(authorName, body) {
  if (/^https:\/\/t\.co\/[A-Za-z0-9]+$/i.test(body)) return cleanTitle(authorName + ": X Article");
  return cleanTitle([authorName, body].filter(Boolean).join(": "));
}

function fetchWeldMetadata(url) {
  const match = String(url).match(/^https?:\/\/(?:www\.)?weld-music\.com\/[^/?#]+\/(\d+)/i);
  if (!match) return {};

  try {
    const response = UrlFetchApp.fetch("https://weld-music.com/wp-json/wp/v2/posts/" + match[1] + "?_fields=title,date,excerpt", {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    const data = JSON.parse(response.getContentText());
    return {
      title: cleanTitle(cleanHtml(data.title && data.title.rendered)),
      published: normalizeDate(data.date || ""),
      description: cleanHtml(data.excerpt && data.excerpt.rendered),
    };
  } catch (error) {
    return {};
  }
}

function fetchWwdMetadata(url) {
  const match = String(url).match(/^https?:\/\/(?:www\.)?wwdjapan\.com\/articles\/(\d+)/i);
  if (!match) return {};

  try {
    const response = UrlFetchApp.fetch("https://www.wwdjapan.com/wp-json/wp/v2/posts/" + match[1] + "?_fields=title,date,excerpt", {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "application/json,text/html",
      },
    });
    const data = JSON.parse(response.getContentText());
    return {
      title: cleanTitle(cleanHtml(data.title && data.title.rendered)),
      published: normalizeDate(data.date || ""),
      description: cleanHtml(data.excerpt && data.excerpt.rendered),
    };
  } catch (error) {
    return {};
  }
}

function fetchReaderMetadata(url) {
  try {
    const response = UrlFetchApp.fetch(buildReaderUrl(url), {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/plain",
      },
    });
    const text = response.getContentText();
    const title = cleanTitle(cleanHtml(matchFirst(text, /^Title:\s*(.+)$/m)));
    return {
      title: isGoodTitle(title) ? title : "",
      published: normalizeDate(matchFirst(text, /^Published Time:\s*(.+)$/m)),
      description: cleanHtml(matchFirst(text, /^Markdown Content:\s*[\r\n]+([\s\S]{0,500})/m)),
    };
  } catch (error) {
    return {};
  }
}

function buildReaderUrl(url) {
  const match = String(url || "").match(/^https?:\/\/([^#]+)/i);
  return "https://r.jina.ai/http://r.jina.ai/http://" + (match ? match[1] : String(url || "").replace(/^\/+/, ""));
}

function pickTitle(html) {
  const candidates = [
    getJsonLdValue(html, "headline"),
    matchFirst(html, /<h[1-3][^>]+class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-3]>/i),
    matchFirst(html, /<h1[^>]+class=["'][^"']*\barticle_[^"']*Title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i),
    getMeta(html, ["cxenseparse:title", "cXenseParse:title"]),
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
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
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
