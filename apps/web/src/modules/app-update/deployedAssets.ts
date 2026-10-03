/**
 * A deployment of the web is identified by the files its index.html loads. Vite names every script and stylesheet by
 * a hash of its content, so this list changes exactly when a reload would bring different code: a deploy that only
 * touches the API or the docs rebuilds the same files and leaves the open tabs alone.
 */

const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<(script|link)\b([^>]*)>/gi;
/** `rel` values of the links that load code or styles (not icons). */
const LOADS_CODE = /(?:^|\s)(?:stylesheet|modulepreload)(?:\s|$)/i;
const ASSET_ELEMENTS = 'script[src], link[rel~="stylesheet"][href], link[rel~="modulepreload"][href]';

/** Value of an attribute in the text of a tag; null when the tag does not have it. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** URLs of the scripts, module preloads and stylesheets the text of an index.html loads, in document order. */
export function assetRefsInHtml(html: string): string[] {
  const refs: string[] = [];
  for (const [, tag, attributes] of html.replace(COMMENT, "").matchAll(TAG)) {
    const ref =
      tag.toLowerCase() === "script"
        ? attribute(attributes, "src")
        : LOADS_CODE.test(attribute(attributes, "rel") ?? "")
          ? attribute(attributes, "href")
          : null;
    if (ref) refs.push(ref);
  }
  return refs;
}

type AssetElement = { getAttribute(name: string): string | null };

/** The same list for the document this tab is running, files of lazy chunks loaded since included. */
export function assetRefsInDocument(doc: { querySelectorAll(selector: string): ArrayLike<AssetElement> }): string[] {
  return Array.from(doc.querySelectorAll(ASSET_ELEMENTS), (element) => element.getAttribute("src") ?? element.getAttribute("href") ?? "").filter(
    (ref) => ref !== "",
  );
}

/**
 * True when the deployed page loads a file this tab did not load: a reload would bring different code.
 * One-sided on purpose: the tab adds links for every lazy chunk it loads, the page never lists those.
 */
export function loadsNewAssets(loaded: readonly string[], deployed: readonly string[]): boolean {
  return deployed.some((ref) => !loaded.includes(ref));
}
