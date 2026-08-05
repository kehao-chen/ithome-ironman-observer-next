// scripts/scrape.test.ts
import { describe, expect, test } from "bun:test";
import { mergeCardsAndStats } from "./scrape";
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
});
