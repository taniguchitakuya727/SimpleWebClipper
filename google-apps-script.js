const SHEET_NAME = "clips";

function doPost(e) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

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
