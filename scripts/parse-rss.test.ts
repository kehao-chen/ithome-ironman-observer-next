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

  test("lastBuildDate preserves the source wall clock at its offset", () => {
    const xml = readFixture("rss-series.xml");
    const ch = parseRss(xml);
    // fixture: <lastBuildDate>Wed, 05 Aug 2026 09:37:43 +0800</lastBuildDate>
    expect(ch.lastBuildDate).toBe("2026-08-05T09:37:43+08:00");
  });

  test("lastBuildDate is null for a malformed date", () => {
    const ch = parseRss("<channel><lastBuildDate>garbage</lastBuildDate></channel>");
    expect(ch.lastBuildDate).toBeNull();
  });

  test("rssUrl builds correct URL", () => {
    expect(rssUrl(9066)).toBe("https://ithelp.ithome.com.tw/rss/series/9066");
  });
});
