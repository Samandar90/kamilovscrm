import { describe, expect, it } from "vitest";
import sourceIndexHtml from "../../../index.html?raw";
import viteConfigSource from "../../../vite.config.ts?raw";
import { assetRefsInDocument, assetRefsInHtml, loadsNewAssets } from "./deployedAssets";

/** index.html as `vite build` writes it (shape taken from production on 2026-10-03). */
const builtIndexHtml = (script = "index-CN9j9FYx.js", style = "index-CKNx-yYh.css") => `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <title>Sazion CRM</title>
    <link rel="icon" href="/favicon.ico" />
    <link rel="apple-touch-icon" href="/logo.png" />
    <script id="tv-boot-watchdog">
      (function (w) { if (w.location.pathname !== "/tv") return; })(window);
    </script>
    <script type="module" crossorigin src="/assets/${script}"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-B1x2y3z4.js">
    <link rel="stylesheet" crossorigin href="/assets/${style}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe("assetRefsInHtml", () => {
  it("lists the scripts, module preloads and stylesheets of a built page, not its icons or inline scripts", () => {
    expect(assetRefsInHtml(builtIndexHtml())).toEqual([
      "/assets/index-CN9j9FYx.js",
      "/assets/vendor-B1x2y3z4.js",
      "/assets/index-CKNx-yYh.css",
    ]);
  });

  it("reads attributes in any order, case and quoting", () => {
    const html = `<SCRIPT SRC='/assets/a.js' type=module></SCRIPT><link href=/assets/b.css rel=stylesheet><link href="/assets/c.js" rel="modulepreload">`;
    expect(assetRefsInHtml(html)).toEqual(["/assets/a.js", "/assets/b.css", "/assets/c.js"]);
  });

  it("skips what is commented out", () => {
    const html = `<!-- <script type="module" src="/assets/old.js"></script> --><script type="module" src="/assets/new.js"></script>`;
    expect(assetRefsInHtml(html)).toEqual(["/assets/new.js"]);
  });

  it("lists only files of the build, not what other software adds to the page", () => {
    // Kaspersky rewrites every HTML answer on its way to the browser and adds a script with a new address each time:
    // counted as a file, it would make every check report a new version.
    const injected = (attr: string) =>
      `<script type="text/javascript" src="https://gc.kis.v2.scr.kaspersky-labs.com/FD126C42-EBFA-4E12-B309-BB3FDD723AC1/main.js?attr=${attr}" charset="UTF-8"></script>`;
    const html = (attr: string) => builtIndexHtml().replace("<head>", `<head>${injected(attr)}<link rel="stylesheet" href="//cdn.example/assets/x.css">`);
    expect(assetRefsInHtml(html("aGVsbG8"))).toEqual(assetRefsInHtml(builtIndexHtml()));
    expect(loadsNewAssets(assetRefsInHtml(html("aGVsbG8")), assetRefsInHtml(html("d29ybGQ")))).toBe(false);
  });

  it("does not list an icon, even one the build has hashed: it is not code", () => {
    const html = `<link rel="icon" href="/assets/favicon-Aa11Bb22.ico"><script type="module" src="/assets/index-CN9j9FYx.js"></script>`;
    expect(assetRefsInHtml(html)).toEqual(["/assets/index-CN9j9FYx.js"]);
  });

  it("finds no build files in the page of the dev server", () => {
    expect(assetRefsInHtml(sourceIndexHtml)).toEqual([]);
  });

  // The prefix of build files is written into deployedAssets.ts: with another `base` or `assetsDir` no check would
  // ever find a file, and tabs would silently stop noticing new versions.
  it("relies on Vite's default base and assets directory", () => {
    expect(viteConfigSource).not.toMatch(/(base|assetsDir)\s*:/);
  });

  it("finds nothing in a page that is not the app", () => {
    expect(assetRefsInHtml("<html><body><h1>502 Bad Gateway</h1></body></html>")).toEqual([]);
    expect(assetRefsInHtml("")).toEqual([]);
  });
});

describe("assetRefsInDocument", () => {
  const element = (attributes: Record<string, string>) => ({ getAttribute: (name: string) => attributes[name] ?? null });
  /** The document of a running tab: the elements of the built page plus what the tab and other software added. */
  const doc = {
    getElementsByTagName: (tag: string) =>
      tag === "script"
        ? [
            element({ id: "tv-boot-watchdog" }),
            element({ src: "https://gc.kis.v2.scr.kaspersky-labs.com/FD126C42/main.js?attr=aGVsbG8", type: "text/javascript" }),
            element({ src: "/assets/index-CN9j9FYx.js", type: "module", crossorigin: "" }),
          ]
        : tag === "link"
          ? [
              element({ rel: "icon", href: "/favicon.ico" }),
              element({ rel: "icon", href: "/assets/favicon-Aa11Bb22.ico" }),
              element({ rel: "modulepreload", crossorigin: "", href: "/assets/vendor-B1x2y3z4.js" }),
              element({ rel: "stylesheet", crossorigin: "", href: "/assets/index-CKNx-yYh.css" }),
              element({ rel: "modulepreload", as: "script", crossorigin: "", href: "/assets/QueuePage-Ab12Cd34.js" }),
              element({ rel: "STYLESHEET", href: "/assets/TvApp-Ef56Gh78.css" }),
              element({ rel: "stylesheet" }),
            ]
          : [],
  };

  it("lists the build files the running tab loaded, lazy chunks included, and nothing else", () => {
    expect(assetRefsInDocument(doc)).toEqual([
      "/assets/index-CN9j9FYx.js",
      "/assets/vendor-B1x2y3z4.js",
      "/assets/index-CKNx-yYh.css",
      "/assets/QueuePage-Ab12Cd34.js",
      "/assets/TvApp-Ef56Gh78.css",
    ]);
  });

  it("agrees with the page the tab was opened from: no new version right after loading", () => {
    expect(loadsNewAssets(assetRefsInDocument(doc), assetRefsInHtml(builtIndexHtml()))).toBe(false);
  });
});

describe("loadsNewAssets", () => {
  const loaded = assetRefsInHtml(builtIndexHtml());

  it("is false while the deployed page loads the files this tab has", () => {
    expect(loadsNewAssets(loaded, assetRefsInHtml(builtIndexHtml()))).toBe(false);
  });

  it("is true when the entry script changed", () => {
    expect(loadsNewAssets(loaded, assetRefsInHtml(builtIndexHtml("index-D4f8Qq1z.js")))).toBe(true);
  });

  it("is true when only the stylesheet changed", () => {
    expect(loadsNewAssets(loaded, assetRefsInHtml(builtIndexHtml("index-CN9j9FYx.js", "index-Zz91kLm2.css")))).toBe(true);
  });

  it("is false when the tab has since loaded more files than the page lists (lazy chunks)", () => {
    const withLazyChunks = [...loaded, "/assets/QueuePage-Ab12Cd34.js", "/assets/TvApp-Ef56Gh78.css"];
    expect(loadsNewAssets(withLazyChunks, assetRefsInHtml(builtIndexHtml()))).toBe(false);
  });

  it("is false when the deployed list is empty: nothing to compare with", () => {
    expect(loadsNewAssets(loaded, [])).toBe(false);
  });
});
