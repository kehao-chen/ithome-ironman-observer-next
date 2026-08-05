// scripts/test-utils.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readFixture(name: string): string {
  return readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");
}
