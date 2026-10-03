/** Result codes of a sheet read; stored in lead_sources.last_sync_status. */
export type LeadSyncStatus =
  | "ok"
  | "empty"
  | "no_access"
  | "not_found"
  | "columns_not_found"
  | "too_large"
  | "timeout"
  | "http_error";

const SHEETS_HOST = "docs.google.com";

/** Same pattern as the CHECK on lead_sources.spreadsheet_id. */
const SPREADSHEET_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** "/spreadsheets/d/<id>/…", also with the account index Google adds for a second login: "/spreadsheets/u/1/d/<id>/…". */
const SHEET_PATH_RE = /^\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)(?:\/|$)/;

const GID_RE = /[#?&]gid=(\d+)(?:&|$)/;

const MAX_LINK_LENGTH = 2000;

/**
 * Spreadsheet id and tab number from what a superadmin pastes: any docs.google.com sheet link or a bare id.
 * The tab is `gid` from the fragment, else from the query, else 0. Null when it is not a link to a Google sheet.
 */
export function parseSheetUrl(input: string): { spreadsheetId: string; gid: number } | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (text === "" || text.length > MAX_LINK_LENGTH) return null;
  if (SPREADSHEET_ID_RE.test(text)) return { spreadsheetId: text, gid: 0 };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.hostname !== SHEETS_HOST) return null;
  const spreadsheetId = SHEET_PATH_RE.exec(url.pathname)?.[1];
  if (!spreadsheetId || !SPREADSHEET_ID_RE.test(spreadsheetId)) return null;

  const gidText = GID_RE.exec(url.hash)?.[1] ?? GID_RE.exec(url.search)?.[1];
  const gid = gidText === undefined ? 0 : Number(gidText);
  if (!Number.isSafeInteger(gid)) return null;
  return { spreadsheetId, gid };
}

/** The link shown back to the superadmin: "https://docs.google.com/spreadsheets/d/<id>/edit#gid=<gid>". */
export function buildSheetUrl(spreadsheetId: string, gid: number): string {
  return `https://${SHEETS_HOST}/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`;
}
