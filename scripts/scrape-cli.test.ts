import { describe, expect, test } from "bun:test";
import { buildMeta, collectYears } from "./scrape";
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
