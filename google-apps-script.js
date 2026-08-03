const SHEET_NAME = "clips";
const HEADERS = ["timestamp", "title", "source", "author", "published", "created", "description", "tags", "content"];

function doPost(e) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  const clip = JSON.parse(e.postData.contents);
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
