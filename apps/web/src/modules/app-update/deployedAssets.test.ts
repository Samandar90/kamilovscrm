import { describe, expect, it } from "vitest";
import sourceIndexHtml from "../../../index.html?raw";
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

  it("finds the entry module of the source index.html", () => {
    expect(assetRefsInHtml(sourceIndexHtml)).toEqual(["/src/main.tsx"]);
  });

  it("finds nothing in a page that is not the app", () => {
    expect(assetRefsInHtml("<html><body><h1>502 Bad Gateway</h1></body></html>")).toEqual([]);
    expect(assetRefsInHtml("")).toEqual([]);
  });
});

describe("assetRefsInDocument", () => {
  it("lists the files the running tab loaded", () => {
    const element = (attributes: Record<string, string>) => ({ getAttribute: (name: string) => attributes[name] ?? null });
    const selectors: string[] = [];
    const doc = {
      querySelectorAll: (selector: string) => {
        selectors.push(selector);
        return [
          element({ src: "/assets/index-CN9j9FYx.js", type: "module" }),
          element({ href: "/assets/index-CKNx-yYh.css", rel: "stylesheet" }),
        ];
      },
    };
    expect(assetRefsInDocument(doc)).toEqual(["/assets/index-CN9j9FYx.js", "/assets/index-CKNx-yYh.css"]);
    expect(selectors).toHaveLength(1);
    expect(selectors[0]).toContain("script[src]");
    expect(selectors[0]).toContain("stylesheet");
    expect(selectors[0]).toContain("modulepreload");
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
