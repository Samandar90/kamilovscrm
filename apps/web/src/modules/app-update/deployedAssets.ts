/**
 * A deployment of the web is identified by the build files its index.html loads. Vite names every script and
 * stylesheet by a hash of its content, so this list changes exactly when a reload would bring different code: a deploy
 * that only touches the API or the docs rebuilds the same files and leaves the open tabs alone.
 */

/**
 * Where Vite puts the files of a build (`base` + `assetsDir`, both at their defaults in vite.config.ts). Only these
 * count: an antivirus or an ad blocker may add its own script to every HTML answer, under a new address each time.
 */
const BUILD_FILES_PREFIX = `${import.meta.env.BASE_URL}assets/`;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<(script|link)\b([^>]*)>/gi;
/** `rel` values of the links that load code or styles (not icons). */
const LOADS_CODE = /(?:^|\s)(?:stylesheet|modulepreload)(?:\s|$)/i;

const isBuildFile = (ref: string | null): ref is string => ref !== null && ref.startsWith(BUILD_FILES_PREFIX);

/** Value of an attribute in the text of a tag; null when the tag does not have it. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

/** Build files (scripts, module preloads, stylesheets) the text of an index.html loads, in document order. */
export function assetRefsInHtml(html: string): string[] {
  const refs: Array<string | null> = [];
  for (const [, tag, attributes] of html.replace(COMMENT, "").matchAll(TAG)) {
    if (tag.toLowerCase() === "script") refs.push(attribute(attributes, "src"));
    else if (LOADS_CODE.test(attribute(attributes, "rel") ?? "")) refs.push(attribute(attributes, "href"));
  }
  return refs.filter(isBuildFile);
}

type AssetElement = { getAttribute(name: string): string | null };

/** The same list for the document this tab is running, files of the lazy chunks loaded since included. */
export function assetRefsInDocument(doc: { getElementsByTagName(tag: string): ArrayLike<AssetElement> }): string[] {
  const scripts = Array.from(doc.getElementsByTagName("script"), (script) => script.getAttribute("src"));
  const links = Array.from(doc.getElementsByTagName("link"), (link) =>
    LOADS_CODE.test(link.getAttribute("rel") ?? "") ? link.getAttribute("href") : null,
  );
  return [...scripts, ...links].filter(isBuildFile);
}

/**
 * True when the deployed page loads a file this tab did not load: a reload would bring different code.
 * One-sided on purpose: the tab adds links for every lazy chunk it loads, the page never lists those.
 */
export function loadsNewAssets(loaded: readonly string[], deployed: readonly string[]): boolean {
  return deployed.some((ref) => !loaded.includes(ref));
}
