// scripts/scrape.test.ts
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { YearData } from "./types";
import { mergeCardsAndStats, taipeiTimestamp, historyDate, writeHistorySnapshots } from "./scrape";
import { parseSignupList } from "./parse-signup";
import { parseSeriesPage } from "./parse-series";
import { parseRss } from "./parse-rss";
import { readFixture } from "./test-utils";

describe("mergeCardsAndStats", () => {
  test("merges signup + series page into Series[] with rss map", () => {
    const cards = parseSignupList(readFixture("signup-page.html"));
    const card = cards[0];
    expect(card).toBeDefined();
    // stats/rss fixtures describe series 9066; key them under the card's id
    const stats = parseSeriesPage(readFixture("series-page.html"));
    const rss = parseRss(readFixture("rss-series.xml"));
    const series = mergeCardsAndStats(
      [card],
      new Map([[card.seriesId, stats]]),
      new Map([[card.seriesId, rss]]),
    );
    expect(series.length).toBe(1);
    const s = series[0];
    expect(s.title).toBe(card.title);
    expect(s.user.name).toBe(card.name);
    expect(s.articleCount).toBe(stats.articleCount);
    expect(s.articles.length).toBe(stats.articles.length);
    expect(s.articles[0].views).toBe(stats.articles[0].views);
    expect(s.group).toBe(card.group);
    expect(s.lastUpdated).toBe(rss.lastBuildDate);
  });

  test("series with no stats still produced (stats optional)", () => {
    const cards = parseSignupList(readFixture("signup-page.html"));
    const series = mergeCardsAndStats([cards[0]], new Map(), new Map());
    expect(series.length).toBe(1);
    expect(series[0].articles).toEqual([]);
    expect(series[0].articleCount).toBe(0);
  });

  test("taipeiTimestamp renders the real Taipei wall clock with +08:00", () => {
    // value test: the +08:00 suffix must label a wall clock that IS the Taipei
    // time, not UTC digits relabeled (regression for the toISOString mislabel).
    const now = new Date();
    const expected = new Date(now.getTime() + 8 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    const got = taipeiTimestamp(now);
    expect(got).toBe(expected + "+08:00");
  });
});

describe("historyDate", () => {
  test("臺北日期（非 UTC）", () => {
    expect(historyDate("2026-08-06 00:30:00+08:00")).toBe("2026-08-06");
    expect(historyDate("2026-08-05 23:30:00+08:00")).toBe("2026-08-05");
  });
});

describe("writeHistorySnapshots", () => {
  function yearData(over: Partial<YearData> = {}): YearData {
    return {
      year: 2026, updatedAt: "2026-08-06 15:13:18+08:00",
      groups: [], series: [], scrapeLog: [], ...over,
    };
  }

  test("寫入 data/history/{year}/{date}.json 且內容相同", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      const data = yearData({ year: 2026 });
      await writeHistorySnapshots(dir, [data]);
      const content = await readFile(join(dir, "history", "2026", "2026-08-06.json"), "utf-8");
      expect(JSON.parse(content)).toEqual(data);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("已存在相同內容 → 不覆寫（mtime 不變）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      const data = yearData({ year: 2026 });
      const path = join(dir, "history", "2026", "2026-08-06.json");
      await writeHistorySnapshots(dir, [data]);
      const mtime1 = (await import("node:fs")).statSync(path).mtimeMs;
      await new Promise((r) => setTimeout(r, 20));
      await writeHistorySnapshots(dir, [data]);
      const mtime2 = (await import("node:fs")).statSync(path).mtimeMs;
      expect(mtime2).toBe(mtime1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("已存在不同內容 → 覆寫", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      const old = yearData({ year: 2026, series: [] });
      const fresh = yearData({ year: 2026, groups: ["Web"], series: [] });
      const path = join(dir, "history", "2026", "2026-08-06.json");
      await writeHistorySnapshots(dir, [old]);
      await writeHistorySnapshots(dir, [fresh]);
      expect(JSON.parse(await readFile(path, "utf-8"))).toEqual(fresh);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("不同 year 寫不同子目錄", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      await writeHistorySnapshots(dir, [yearData({ year: 2025 }), yearData({ year: 2026 })]);
      expect(JSON.parse(await readFile(join(dir, "history", "2025", "2026-08-06.json"), "utf-8")).year).toBe(2025);
      expect(JSON.parse(await readFile(join(dir, "history", "2026", "2026-08-06.json"), "utf-8")).year).toBe(2026);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("第一年度失敗仍寫入第二年度（review #3）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      // 讓 2026 的 history 目錄位置被一個普通檔案佔住 → mkdir 失敗
      await mkdir(join(dir, "history"), { recursive: true });
      await writeFile(join(dir, "history", "2026"), "blocking file");
      const failures = await writeHistorySnapshots(dir, [
        yearData({ year: 2026 }),
        yearData({ year: 2025 }),
      ]);
      // 2026 失敗、2025 成功
      expect(failures.length).toBe(1);
      expect(failures[0]).toContain("2026");
      expect(JSON.parse(await readFile(join(dir, "history", "2025", "2026-08-06.json"), "utf-8")).year).toBe(2025);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
