// scripts/parse-series.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseSeriesPage, seriesUrl } from "./parse-series";

describe("parseSeriesPage", () => {
  test("parses stats and articles", () => {
    const html = readFixture("series-page.html");
    const s = parseSeriesPage(html);
    expect(s.dayCount).toBeGreaterThanOrEqual(1);
    expect(s.articleCount).toBeGreaterThanOrEqual(1);
    expect(s.subscriptions).toBeGreaterThanOrEqual(0);
    expect(s.articles.length).toBe(s.articleCount);
    const a = s.articles[0];
    expect(a.id).toBeGreaterThan(10000000);
    expect(a.title).toContain("Day 1");
    expect(a.url).toMatch(/articles\/\d+/);
    expect(a.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof a.views).toBe("number");
    expect(typeof a.likes).toBe("number");
    expect(typeof a.comments).toBe("number");
  });

  test("articles have all three stats", () => {
    const html = readFixture("series-page.html");
    const s = parseSeriesPage(html);
    for (const a of s.articles) {
      expect(a.views).toBeGreaterThanOrEqual(0);
      expect(a.likes).toBeGreaterThanOrEqual(0);
      expect(a.comments).toBeGreaterThanOrEqual(0);
    }
  });
});
