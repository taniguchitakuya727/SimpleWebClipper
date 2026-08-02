const SHEET_NAME = "clips";

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const clip = JSON.parse(e.postData.contents);
  ensureHeader(sheet);
  sheet.appendRow([
    new Date(),
    clip.title || "",
    clip.source || clip.url || "",
    clip.author || "",
    clip.published || "",
    clip.created || "",
    clip.description || "",
    clip.tags || "clippings",
    clip.content || "",
  ]);

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(["timestamp", "title", "source", "author", "published", "created", "description", "tags", "content"]);
}
