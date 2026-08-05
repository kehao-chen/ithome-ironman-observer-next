// scripts/parse-rss.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseRss, rssUrl } from "./parse-rss";

describe("parseRss", () => {
  test("parses channel and items", () => {
    const xml = readFixture("rss-series.xml");
    const ch = parseRss(xml);
    expect(ch.title).toContain("2026");
    expect(ch.link).toContain("ithelp.ithome.com.tw");
    expect(ch.items.length).toBeGreaterThan(0);
    const item = ch.items[0];
    expect(item.title).toMatch(/Day \d+/);
    expect(item.link).toMatch(/articles\/\d+/);
    expect(item.pubDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("lastBuildDate parses to ISO", () => {
    const xml = readFixture("rss-series.xml");
    const ch = parseRss(xml);
    expect(ch.lastBuildDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("rssUrl builds correct URL", () => {
    expect(rssUrl(9066)).toBe("https://ithelp.ithome.com.tw/rss/series/9066");
  });
});
