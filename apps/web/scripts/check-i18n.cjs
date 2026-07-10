/**
 * i18n guard: fails the build when translation keys referenced in source code
 * are missing from ru.json/uz.json, or when the two locales diverge.
 *
 * Catches both `t("ns.key")` literals and key strings stored in constants
 * (label maps, configs) that are translated later at render time.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ru = JSON.parse(fs.readFileSync(path.join(ROOT, "src/locales/ru.json"), "utf8"));
const uz = JSON.parse(fs.readFileSync(path.join(ROOT, "src/locales/uz.json"), "utf8"));

function flat(obj, prefix, out) {
  for (const k of Object.keys(obj)) {
    const p = prefix ? prefix + "." + k : k;
    if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) flat(obj[k], p, out);
    else out.add(p);
  }
  return out;
}

const ruKeys = flat(ru, "", new Set());
const uzKeys = flat(uz, "", new Set());
const nsPattern = Object.keys(ru).join("|");
const keyRe = new RegExp(`["'\`]((?:${nsPattern})\\.[a-zA-Z0-9_.]+)["'\`]`, "g");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !e.name.includes(".test.")) yield p;
  }
}

let failed = false;

const missing = new Map();
for (const file of walk(path.join(ROOT, "src"))) {
  const content = fs.readFileSync(file, "utf8");
  let m;
  keyRe.lastIndex = 0;
  while ((m = keyRe.exec(content)) !== null) {
    const key = m[1];
    if (!ruKeys.has(key) || !uzKeys.has(key)) {
      if (!missing.has(key)) missing.set(key, path.relative(ROOT, file));
    }
  }
}

if (missing.size > 0) {
  failed = true;
  console.error(`\n[i18n] ${missing.size} key(s) used in code but missing from locales:`);
  for (const [k, f] of missing) console.error(`  ${k}  <-  ${f}`);
}

const ruOnly = [...ruKeys].filter((k) => !uzKeys.has(k));
const uzOnly = [...uzKeys].filter((k) => !ruKeys.has(k));
if (ruOnly.length || uzOnly.length) {
  failed = true;
  if (ruOnly.length) {
    console.error(`\n[i18n] ${ruOnly.length} key(s) present in ru.json but missing from uz.json:`);
    for (const k of ruOnly.slice(0, 50)) console.error(`  ${k}`);
  }
  if (uzOnly.length) {
    console.error(`\n[i18n] ${uzOnly.length} key(s) present in uz.json but missing from ru.json:`);
    for (const k of uzOnly.slice(0, 50)) console.error(`  ${k}`);
  }
}

if (failed) {
  console.error("\n[i18n] Check failed. Add the missing keys to both locale files.\n");
  process.exit(1);
}
console.log(`[i18n] OK: ${ruKeys.size} keys, full ru/uz parity, all code references resolve.`);
