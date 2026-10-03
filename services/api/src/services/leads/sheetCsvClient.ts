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

export type SheetFetchResult =
  | { status: "ok"; text: string }
  | { status: "no_access" | "not_found" | "too_large" | "timeout" | "http_error" };

type SheetFetchFailure = Exclude<SheetFetchResult["status"], "ok">;

/** One limit for the whole read: every redirect and the body. */
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024;
const MAX_BODY_CHARS = 5_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Google serves the export from docs.google.com and from *.googleusercontent.com; nothing else is requested. */
const isGoogleExportUrl = (url: URL): boolean =>
  url.protocol === "https:" &&
  url.port === "" &&
  (url.hostname === SHEETS_HOST || url.hostname.endsWith(".googleusercontent.com"));

/** Releases the connection of an answer whose body is not read. */
const discardBody = (res: Response): void => {
  try {
    void res.body?.cancel().catch(() => undefined);
  } catch {
    // The body is already released.
  }
};

/** Why the answer is not a sheet, or null when it is a CSV worth reading. */
const failureOf = (res: Response): SheetFetchFailure | null => {
  if (res.status === 401 || res.status === 403) return "no_access";
  if (res.status === 404 || res.status === 410) return "not_found";
  if (res.status !== 200) return "http_error";
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  // A page instead of the export is Google's sign-in or "no permission" screen; it is never parsed as rows.
  if (contentType.startsWith("text/html")) return "no_access";
  if (!contentType.startsWith("text/csv")) return "http_error";
  if (Number(res.headers.get("content-length")) > MAX_CONTENT_LENGTH) return "too_large";
  return null;
};

/** Body as text, or null as soon as it is longer than the limit: the rest is not downloaded. */
const readBody = async (res: Response): Promise<string | null> => {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > MAX_BODY_CHARS) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
  }
  text += decoder.decode();
  return text.length > MAX_BODY_CHARS ? null : text;
};

/**
 * CSV export of one tab of a link-shared sheet. The address is built here from the id and the tab number,
 * redirects are followed by hand (at most 5, Google hosts only): a redirect anywhere else, e.g. to the
 * sign-in page, means the sheet is not shared by link. A failure is a status, never "an empty sheet".
 * Never logs and never throws.
 */
export async function fetchSheetCsv(
  spreadsheetId: string,
  gid: number,
  fetchImpl: typeof fetch = fetch
): Promise<SheetFetchResult> {
  try {
    if (!SPREADSHEET_ID_RE.test(spreadsheetId) || !Number.isSafeInteger(gid) || gid < 0) {
      return { status: "not_found" };
    }
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let url = `https://${SHEETS_HOST}/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;

    for (let redirects = 0; ; redirects += 1) {
      const res = await fetchImpl(url, { redirect: "manual", signal });

      if (!REDIRECT_STATUSES.has(res.status)) {
        const failure = failureOf(res);
        if (failure) {
          discardBody(res);
          return { status: failure };
        }
        const text = await readBody(res);
        return text === null ? { status: "too_large" } : { status: "ok", text };
      }

      discardBody(res);
      const location = res.headers.get("location");
      if (!location) return { status: "http_error" };
      const next = new URL(location, url);
      if (!isGoogleExportUrl(next)) return { status: "no_access" };
      if (redirects === MAX_REDIRECTS) return { status: "http_error" };
      url = next.href;
    }
  } catch (err) {
    const name = (err as { name?: unknown } | null | undefined)?.name;
    return { status: name === "TimeoutError" || name === "AbortError" ? "timeout" : "http_error" };
  }
}
