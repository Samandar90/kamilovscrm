import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSheetUrl, fetchSheetCsv, parseSheetUrl } from "./sheetCsvClient";

/** A made-up id of the usual length (44); no real spreadsheet is named in tests. */
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-aBcDe";
const SHEET = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

describe("parseSheetUrl", () => {
  it("uses a 44-character id in these tests", () => {
    expect(SHEET_ID).toHaveLength(44);
  });

  it.each([
    [`${SHEET}/edit?usp=sharing`, 0], // the link the "Share" button gives
    [`${SHEET}/edit#gid=123`, 123],
    [`${SHEET}/edit?gid=123#gid=123`, 123],
    [`${SHEET}/edit?usp=sharing&gid=45`, 45], // gid only in the query
    [`${SHEET}/edit?gid=1#gid=2`, 2], // the fragment is the tab that is open
    [`${SHEET}/edit#gid=7&range=A1`, 7],
    [`${SHEET}/edit#gid=0`, 0],
    [`${SHEET}`, 0],
    [`${SHEET}/`, 0],
    [`https://docs.google.com/spreadsheets/u/1/d/${SHEET_ID}/edit#gid=9`, 9], // second signed-in account
    [`docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=5`, 5], // pasted without the scheme
    [`  ${SHEET}/edit?usp=sharing \n`, 0],
    [SHEET_ID, 0], // a bare id
  ])("reads %j → gid %d", (input, gid) => {
    expect(parseSheetUrl(input)).toEqual({ spreadsheetId: SHEET_ID, gid });
  });

  it.each([20, 100])("takes a bare id of %d characters", (length) => {
    const id = "a".repeat(length);
    expect(parseSheetUrl(id)).toEqual({ spreadsheetId: id, gid: 0 });
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`)).toEqual({ spreadsheetId: id, gid: 0 });
  });

  it.each([
    ["", "empty"],
    ["   ", "spaces only"],
    [`https://evil.example/spreadsheets/d/${SHEET_ID}/edit`, "another host"],
    [`https://docs.google.com.evil.example/spreadsheets/d/${SHEET_ID}/edit`, "a host that only starts like Google"],
    [`https://docs.google.com@evil.example/spreadsheets/d/${SHEET_ID}/edit`, "Google as the user name of another host"],
    [`https://sheets.google.com/spreadsheets/d/${SHEET_ID}/edit`, "another Google host"],
    ["https://docs.google.com/spreadsheets/", "a path without /d/<id>"],
    ["https://docs.google.com/spreadsheets/u/0/", "the list of sheets"],
    [`https://docs.google.com/document/d/${SHEET_ID}/edit`, "a document, not a sheet"],
    [`https://docs.google.com/spreadsheets/d/${SHEET_ID.slice(0, 19)}/edit`, "an id shorter than 20"],
    [`https://docs.google.com/spreadsheets/d/${"a".repeat(101)}/edit`, "an id longer than 100"],
    ["https://docs.google.com/spreadsheets/d/e/2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz/pubhtml", "a published copy"],
    [`${SHEET}/edit#gid=99999999999999999999`, "a gid that is not a safe integer"],
    [SHEET_ID.slice(0, 19), "a bare id shorter than 20"],
    ["a".repeat(101), "a bare id longer than 100"],
    ["таблица лидов таргетолога", "plain text"],
    [`${SHEET_ID}/../x`, "an id with a path"],
    [`${SHEET}/edit?x=${"a".repeat(3000)}`, "a link longer than 2000 characters"],
  ])("rejects %j (%s)", (input) => {
    expect(parseSheetUrl(input)).toBeNull();
  });

  it("returns null for a value that is not a string", () => {
    expect(parseSheetUrl(null as unknown as string)).toBeNull();
    expect(parseSheetUrl(123 as unknown as string)).toBeNull();
  });
});

describe("buildSheetUrl", () => {
  it("builds the link to the sheet tab", () => {
    expect(buildSheetUrl(SHEET_ID, 7)).toBe(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=7`);
  });

  it("round-trips through parseSheetUrl", () => {
    expect(parseSheetUrl(buildSheetUrl(SHEET_ID, 7))).toEqual({ spreadsheetId: SHEET_ID, gid: 7 });
    expect(parseSheetUrl(buildSheetUrl(SHEET_ID, 0))).toEqual({ spreadsheetId: SHEET_ID, gid: 0 });
  });
});

const EXPORT_URL = `${SHEET}/export?format=csv&gid=0`;
const CONTENT_HOST = "https://doc-0-0-sheets.googleusercontent.com";
const FIVE_MB = 5 * 1024 * 1024;

const csv = (body: string | null, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", ...headers } });
const redirect = (location: string, status = 307) => new Response(null, { status, headers: { location } });
const page = (status: number) =>
  new Response("<html>Sign in</html>", { status, headers: { "content-type": "text/html; charset=utf-8" } });
/** A 200 text/csv answer whose body is the given stream. */
const csvStream = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/csv", ...headers } });

type Answer = Response | (() => Response) | { reject: unknown };

/** A fetch that answers from the list (the last answer repeats) and records what was asked. No network. */
function fakeFetch(...answers: Answer[]) {
  const urls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  const impl = (async (...[input, init]: Parameters<typeof fetch>) => {
    urls.push(String(input));
    inits.push(init);
    const answer = answers[Math.min(urls.length, answers.length) - 1];
    if (typeof answer === "function") return answer();
    if ("reject" in answer) throw answer.reject;
    return answer;
  }) as typeof fetch;
  return { impl, urls, inits };
}

describe("fetchSheetCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("asks Google for the CSV export of the tab, without following redirects, with a 20 s limit", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { impl, urls, inits } = fakeFetch(csv("phone,name\n998901234567,Test"));

    expect(await fetchSheetCsv(SHEET_ID, 7, impl)).toEqual({ status: "ok", text: "phone,name\n998901234567,Test" });
    expect(urls).toEqual([`${SHEET}/export?format=csv&gid=7`]);
    expect(inits[0]?.redirect).toBe("manual");
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(20000);
    expect(inits[0]?.signal).toBe(timeout.mock.results[0].value);
  });

  it("follows the redirect to the Google content host and returns the CSV", async () => {
    const { impl, urls, inits } = fakeFetch(redirect(`${CONTENT_HOST}/export/abc?format=csv`), csv("a,b\n1,2\n"));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "ok", text: "a,b\n1,2\n" });
    expect(urls).toEqual([EXPORT_URL, `${CONTENT_HOST}/export/abc?format=csv`]);
    expect(inits[1]?.redirect).toBe("manual");
    expect(inits[1]?.signal).toBe(inits[0]?.signal); // one limit for the whole read
  });

  it("follows a relative redirect on the same host", async () => {
    const { impl, urls } = fakeFetch(redirect("/spreadsheets/d/x/export2", 302), csv("a"));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "ok", text: "a" });
    expect(urls[1]).toBe("https://docs.google.com/spreadsheets/d/x/export2");
  });

  it("reads a redirect to the Google sign-in page as no access", async () => {
    const { impl, urls } = fakeFetch(redirect("https://accounts.google.com/ServiceLogin?continue=x", 302), csv("a"));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "no_access" });
    expect(urls).toEqual([EXPORT_URL]);
  });

  it.each([
    ["https://evil.example/"],
    ["http://docs.google.com/spreadsheets/d/x/export"], // not https
    ["https://evilgoogleusercontent.com/x"], // no dot before the suffix
    ["https://googleusercontent.com/x"], // the bare domain is not a content host
    ["https://doc-0-0-sheets.googleusercontent.com.evil.example/x"],
    ["https://docs.google.com.evil.example/x"],
    ["https://docs.google.com@evil.example/x"],
    ["https://docs.google.com:8443/x"],
    ["//evil.example/x"], // scheme-relative
    ["file:///etc/passwd"],
  ])("does not request a redirect target outside Google: %s", async (location) => {
    const { impl, urls } = fakeFetch(redirect(location), csv("a"));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "no_access" });
    expect(urls).toEqual([EXPORT_URL]);
  });

  it.each([
    [401, "no_access"],
    [403, "no_access"],
    [404, "not_found"],
    [410, "not_found"],
    [400, "not_found"],
    [429, "http_error"],
    [500, "http_error"],
    [503, "http_error"],
  ])("maps HTTP %d to %s", async (status, expected) => {
    const { impl } = fakeFetch(page(status));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: expected });
  });

  it("reads a 200 HTML page as no access, not as a sheet", async () => {
    const { impl } = fakeFetch(page(200));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "no_access" });
  });

  it.each([["application/json"], ["text/plain"], [""]])("does not take a 200 answer of type %j for CSV", async (contentType) => {
    const { impl } = fakeFetch(new Response("a,b", { status: 200, headers: { "content-type": contentType } }));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "http_error" });
  });

  it("gives up after more than 5 redirects", async () => {
    const { impl, urls } = fakeFetch(() => redirect(`${CONTENT_HOST}/again`));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "http_error" });
    expect(urls).toHaveLength(6); // the export address and 5 redirects
  });

  it("still reads the sheet after exactly 5 redirects", async () => {
    const hop = () => redirect(`${CONTENT_HOST}/again`);
    const { impl, urls } = fakeFetch(hop, hop, hop, hop, hop, csv("a"));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "ok", text: "a" });
    expect(urls).toHaveLength(6);
  });

  it("reads a redirect without a Location header as an HTTP error", async () => {
    const { impl, urls } = fakeFetch(new Response(null, { status: 302 }), csv("a"));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "http_error" });
    expect(urls).toHaveLength(1);
  });

  it("rejects by content-length above 5 MB without reading the body", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const { impl } = fakeFetch(csvStream(body, { "content-length": String(FIVE_MB + 1) }));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "too_large" });
    expect(pulled).toBeLessThanOrEqual(1); // only the stream's own read-ahead
  });

  it("accepts a content-length of exactly 5 MB", async () => {
    const { impl } = fakeFetch(csv("a,b", { "content-length": String(FIVE_MB) }));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "ok", text: "a,b" });
  });

  it("rejects a body longer than 5 000 000 characters", async () => {
    const { impl } = fakeFetch(csv("a".repeat(5_000_001)));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "too_large" });
  });

  it("accepts a body of exactly 5 000 000 characters", async () => {
    const { impl } = fakeFetch(csv("a".repeat(5_000_000)));

    const result = await fetchSheetCsv(SHEET_ID, 0, impl);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.text.length).toBe(5_000_000);
  });

  it("stops reading a body that never ends", async () => {
    let pulled = 0;
    const megabyte = new Uint8Array(1024 * 1024).fill(0x61);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(megabyte);
      },
    });
    const { impl } = fakeFetch(csvStream(endless));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "too_large" });
    expect(pulled).toBeLessThanOrEqual(7);
  });

  it("decodes UTF-8 text split between chunks", async () => {
    const bytes = new TextEncoder().encode("Имя,Телефон\nАлишер,998901234567");
    const chunks = [bytes.slice(0, 3), bytes.slice(3, 10), bytes.slice(10)]; // the first cut is inside a letter
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const { impl } = fakeFetch(csvStream(body));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "ok", text: "Имя,Телефон\nАлишер,998901234567" });
  });

  it.each([["TimeoutError"], ["AbortError"]])("reads a %s from fetch as a timeout", async (name) => {
    const { impl } = fakeFetch({ reject: new DOMException("The operation was aborted", name) });

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "timeout" });
  });

  it("reads a timeout while the body is being read as a timeout", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a,b\n"));
      },
      pull(controller) {
        controller.error(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      },
    });
    const { impl } = fakeFetch(csvStream(body));

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "timeout" });
  });

  it.each([
    [new TypeError("fetch failed")],
    [new Error("getaddrinfo ENOTFOUND docs.google.com")],
    ["a string"],
    [null],
    [undefined],
  ])("reads any other failure of fetch as an HTTP error: %s", async (reason) => {
    const { impl } = fakeFetch({ reject: reason });

    expect(await fetchSheetCsv(SHEET_ID, 0, impl)).toEqual({ status: "http_error" });
  });

  it("returns an empty text for an empty sheet, not an error", async () => {
    expect(await fetchSheetCsv(SHEET_ID, 0, fakeFetch(csv("")).impl)).toEqual({ status: "ok", text: "" });
    expect(await fetchSheetCsv(SHEET_ID, 0, fakeFetch(csv(null)).impl)).toEqual({ status: "ok", text: "" });
  });

  it.each([
    ["../../u/0/d/x", 0],
    ["short", 0],
    ["", 0],
    [SHEET_ID, -1],
    [SHEET_ID, 1.5],
    [SHEET_ID, Number.NaN],
  ])("does not send a request for an id or a tab that cannot exist: %j, %d", async (spreadsheetId, gid) => {
    const { impl, urls } = fakeFetch(csv("a"));

    expect(await fetchSheetCsv(spreadsheetId, gid, impl)).toEqual({ status: "not_found" });
    expect(urls).toEqual([]);
  });

  it("uses the global fetch when none is passed", async () => {
    const { impl, urls } = fakeFetch(csv("a,b"));
    vi.stubGlobal("fetch", impl);

    expect(await fetchSheetCsv(SHEET_ID, 3)).toEqual({ status: "ok", text: "a,b" });
    expect(urls).toEqual([`${SHEET}/export?format=csv&gid=3`]);
  });

  it("never logs and never throws", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );
    const answers: Answer[] = [
      csv("phone\n998901234567"),
      page(403),
      page(500),
      redirect("https://accounts.google.com/ServiceLogin"),
      { reject: new Error(`connect failed for ${EXPORT_URL}`) },
      { reject: new DOMException("timeout", "TimeoutError") },
    ];

    for (const answer of answers) {
      await expect(fetchSheetCsv(SHEET_ID, 0, fakeFetch(answer).impl)).resolves.toHaveProperty("status");
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
