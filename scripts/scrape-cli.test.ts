import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMeta, collectYears, commitWrites, stageWrites } from "./scrape";
import type { Manifest, YearData } from "./types";

const m2025: Manifest = { year: 2025, signupListUrl: "https://x/2025" };
const m2026: Manifest = { year: 2026, signupListUrl: "https://x/2026" };
const data = (year: number, n: number): YearData => ({
  year, updatedAt: `${year}-01-01 00:00:00+08:00`, groups: ["G"], series: Array.from({ length: n }, (_, i) => ({
    id: i, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "t", description: "d",
    team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
    dayCount: 0, articleCount: 0, subscriptions: 0, articles: [],
  })), scrapeLog: [],
});

describe("collectYears", () => {
  test("one throw, one ok: ok year survives, throw isolated", async () => {
    const { succeeded, failures } = await collectYears([m2025, m2026], async (m) => {
      if (m.year === 2025) throw new Error("signup fetch failed");
      return data(2026, 3);
    });
    expect(succeeded.map((d) => d.year)).toEqual([2026]);
    expect(failures).toEqual(["2025: signup fetch failed"]);
  });

  test("empty year counts as failure, keeps succeeded year", async () => {
    const { succeeded } = await collectYears([m2025, m2026], async (m) =>
      m.year === 2025 ? data(2025, 0) : data(2026, 3),
    );
    expect(succeeded.map((d) => d.year)).toEqual([2026]);
  });

  test("all years fail: succeeded empty", async () => {
    const { succeeded, failures } = await collectYears([m2025, m2026], async () => {
      throw new Error("boom");
    });
    expect(succeeded).toEqual([]);
    expect(failures).toHaveLength(2);
  });
});

describe("buildMeta", () => {
  test("years desc, latestYear = first, updatedAt/seriesCount from latest", () => {
    const meta = buildMeta([data(2025, 2), data(2026, 5)]);
    expect(meta.years).toEqual([2026, 2025]);
    expect(meta.latestYear).toBe(2026);
    expect(meta.seriesCount).toBe(5);
    expect(meta.updatedAt).toBe("2026-01-01 00:00:00+08:00");
  });
});

describe("two-phase atomic write", () => {
  const dir = () => mkdtemp(join(tmpdir(), "scrape-cli-"));
  const cleanup = (d: string) => rm(d, { recursive: true, force: true });

  test("stageWrites creates .tmp siblings; finals untouched until commitWrites", async () => {
    const d = await dir();
    try {
      // Pre-existing data stays readable while staging is in flight.
      await writeFile(join(d, "2025.json"), "old 2025");
      await writeFile(join(d, "meta.json"), "old meta");
      const meta = buildMeta([data(2025, 2), data(2026, 5)]);
      const staged = await stageWrites(d, [data(2025, 2), data(2026, 5)], meta);
      expect(staged.map((s) => s.finalPath)).toEqual([join(d, "2025.json"), join(d, "2026.json"), join(d, "meta.json")]);
      // Finals untouched, temps staged, meta staged last.
      expect(await readFile(join(d, "2025.json"), "utf-8")).toBe("old 2025");
      expect(await readFile(join(d, "meta.json"), "utf-8")).toBe("old meta");
      expect(await readFile(join(d, "2025.json.tmp"), "utf-8")).toBe(JSON.stringify(data(2025, 2), null, 2));
      expect(await readFile(join(d, "2026.json.tmp"), "utf-8")).toBe(JSON.stringify(data(2026, 5), null, 2));
      expect(await readFile(join(d, "meta.json.tmp"), "utf-8")).toBe(JSON.stringify(meta, null, 2));
    } finally { await cleanup(d); }
  });

  test("commitWrites renames temps into place, replacing previous finals", async () => {
    const d = await dir();
    try {
      await writeFile(join(d, "2026.json"), "old 2026");
      const meta = buildMeta([data(2026, 3)]);
      const staged = await stageWrites(d, [data(2026, 3)], meta);
      await commitWrites(staged);
      expect(await readFile(join(d, "2026.json"), "utf-8")).toBe(JSON.stringify(data(2026, 3), null, 2));
      expect(await readFile(join(d, "meta.json"), "utf-8")).toBe(JSON.stringify(meta, null, 2));
      // No .tmp or .bak leftovers.
      expect((await import("node:fs")).readdirSync(d).sort()).toEqual(["2026.json", "meta.json"]);
    } finally { await cleanup(d); }
  });

  test("mid-commit failure rolls back already-replaced finals and cleans up", async () => {
    const d = await dir();
    try {
      // Pre-existing finals from the previous successful run.
      await writeFile(join(d, "2025.json"), "old 2025");
      await writeFile(join(d, "meta.json"), "old meta");
      // Sabotage the SECOND rename: a directory at a later finalPath makes
      // rename(tmp, finalPath) fail on POSIX, forcing a rollback of the FIRST
      // file, which has already been renamed into place by then.
      await mkdir(join(d, "2026.json"));
      const meta = buildMeta([data(2025, 2), data(2026, 5)]);
      const staged = await stageWrites(d, [data(2025, 2), data(2026, 5)], meta);
      await expect(commitWrites(staged)).rejects.toThrow();
      // The already-replaced 2025.json must be restored to its original content.
      expect(await readFile(join(d, "2025.json"), "utf-8")).toBe("old 2025");
      // The sabotaged target is untouched (still a directory), and its backup
      // copy was removed; meta.json was never renamed (third in order).
      expect((await import("node:fs")).statSync(join(d, "2026.json")).isDirectory()).toBe(true);
      expect(await readFile(join(d, "meta.json"), "utf-8")).toBe("old meta");
      // No .bak or .tmp residue.
      expect((await import("node:fs")).readdirSync(d).sort()).toEqual(["2025.json", "2026.json", "meta.json"]);
    } finally { await cleanup(d); }
  });
});
