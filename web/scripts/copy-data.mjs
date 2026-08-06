import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = join(root, "data");
const outDir = join(root, "web", "public", "data");
mkdirSync(outDir, { recursive: true });

// Clean: remove previously copied year files so removed sources don't linger.
for (const f of readdirSync(outDir)) {
  if (/^\d{4}\.json$/.test(f)) rmSync(join(outDir, f));
}

// Copy every year data file (meta.json is intentionally NOT copied — client doesn't need it).
let copied = 0;
for (const f of readdirSync(dataDir)) {
  if (/^\d{4}\.json$/.test(f)) {
    copyFileSync(join(dataDir, f), join(outDir, f));
    copied++;
  }
}
console.log(`copied ${copied} year file(s) -> web/public/data`);
