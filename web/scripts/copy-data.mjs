import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "web", "public", "data");
mkdirSync(outDir, { recursive: true });
copyFileSync(join(root, "data", "2026.json"), join(outDir, "2026.json"));
console.log("copied data/2026.json -> web/public/data/2026.json");
