import { google } from "googleapis";

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

export async function readGoogleSheet(sheetId: string, range: string = "Sheet1"): Promise<any[][]> {
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: range,
  });

  return res.data.values || [];
}

// Legacy function for backward compatibility
export async function readGoogleSheetAsStrings(sheetId: string): Promise<string[]> {
  const rows = await readGoogleSheet(sheetId);
  return rows
    .slice(1)
    .map(r => r.join(" ").trim())
    .filter(Boolean);
}
