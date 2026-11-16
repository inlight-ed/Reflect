/**
 * Checks the web app's translation catalog (artifacts/shift-market/src/locales).
 *
 * Fails when:
 *  - a key is defined in more than one domain file;
 *  - a translation is empty;
 *  - ru / kk / en use different {placeholders};
 *  - the app calls t('…'), safeT('…') or text('…') with a literal key that is not in the catalog
 *    (the UI would silently show the raw key).
 * Completeness of each entry is enforced by the Triple type at typecheck time.
 *
 * Run: pnpm --filter @workspace/scripts run check:i18n
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Triple = readonly [string, string, string];
type Catalog = Record<string, Triple>;

const appRoot = resolve(import.meta.dirname, "../../artifacts/shift-market/src");
const { domains } = (await import(pathToFileURL(join(appRoot, "locales/index.ts")).href)) as { domains: Record<string, Catalog> };

const errors: string[] = [];
const owner = new Map<string, string>();
const placeholders = (value: string) => (value.match(/\{\w+\}/g) ?? []).sort().join(",");

for (const [domain, catalog] of Object.entries(domains)) {
  for (const [key, triple] of Object.entries(catalog)) {
    const previous = owner.get(key);
    if (previous) errors.push(`duplicate key "${key}" in ${previous}.ts and ${domain}.ts`);
    owner.set(key, domain);
    triple.forEach((value, index) => {
      if (!value.trim()) errors.push(`empty ${["ru", "kk", "en"][index]} text for "${key}" (${domain}.ts)`);
    });
    const [ru, kk, en] = triple.map(placeholders);
    if (ru !== kk || ru !== en) errors.push(`placeholders differ for "${key}" (${domain}.ts): ru[${ru}] kk[${kk}] en[${en}]`);
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "locales" || name === "ui" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const call = /\b(?:t|safeT|text)\(\s*(['"])((?:\\.|(?!\1)[^\\])+)\1\s*[,)]/g;
let used = 0;
for (const file of sourceFiles(appRoot)) {
  const code = readFileSync(file, "utf8");
  for (const match of code.matchAll(call)) {
    const key = match[2]!.replace(/\\(['"\\])/g, "$1");
    used += 1;
    if (!owner.has(key)) errors.push(`missing key "${key}" used in ${file.slice(appRoot.length + 1)}`);
  }
}

if (errors.length) {
  console.error(errors.map((line) => `✗ ${line}`).join("\n"));
  console.error(`\n${errors.length} translation problem(s).`);
  process.exit(1);
}
console.log(`✓ ${owner.size} keys in ${Object.keys(domains).length} files, ${used} literal lookups checked.`);
