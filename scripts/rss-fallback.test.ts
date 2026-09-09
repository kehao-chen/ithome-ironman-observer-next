import { describe, expect, test } from "bun:test";
import { runScrape, scrapeSeriesFull, scrapeSeriesIncremental } from "./scrape";
import type { Series, SignupCard } from "./types";

const card: SignupCard = {
  seriesId: 9038, userId: 1, name: "Author", group: "Software",
  title: "Series", description: "", team: null, signupDate: "2026-08-01 00:00:00", day: 4,
};
const cached: Series = {
  id: 9038, user: { id: 1, name: "Author", profileUrl: "" }, group: "Software",
  title: "Series", description: "", team: null, signupDate: "2026-08-01T00:00:00+08:00",
  lastUpdated: "2026-08-02T00:00:00+08:00", articleCount: 2, dayCount: 2, subscriptions: 5,
  articles: [1, 2].map(day => ({ id: 100 + day, day, title: `Day ${day}`,
    url: `https://ithelp.ithome.com.tw/articles/${100 + day}`,
    publishedAt: `2026-08-0${day}T00:00:00+08:00`, views: 42, likes: 3, comments: 2 })),
};
const item = (id: number, day: number) => `<item><title>Day ${day}</title><link>https://ithelp.ithome.com.tw/articles/${id}</link><pubDate>2026-08-04 00:00:00</pubDate></item>`;

for (const scrape of [scrapeSeriesFull, scrapeSeriesIncremental]) {
  describe(scrape.name, () => {
    const fetcher = (rss: string, html?: string) => async (url: string) => {
      if (url.includes("/rss/series/")) return rss;
      if (html !== undefined) return html;
      throw new Error("HTTP 403 (Cloudflare challenge)");
    };
    test("merges truncated RSS without dropping cached articles or refreshing metrics", async () => {
      const res = await scrape(card, cached, fetcher(`<channel>${item(102, 2)}${item(104, 30)}${item(104, 30)}</channel>`));
      expect(res.status).toBe("stale");
      if (res.status !== "stale") throw new Error("Expected degraded result");
      expect(res.series.articles.map(a => a.id)).toEqual([101, 102, 104]);
      expect(res.series.articleCount).toBe(3);
      expect(res.series.dayCount).toBe(4);
      expect(res.series.articles[1].views).toBe(42);
      expect(res.series.articles[2].views).toBe(0);
      expect(res.series.subscriptions).toBe(5);
      expect(res.error).toContain("403");
      expect(res.error).toContain("RSS fallback");
    });
    for (const rss of ["<channel></channel>", "<html>Challenge</html>", "<channel><item><title>Bad link</title><link>invalid</link></item></channel>"]) {
      test(`unusable RSS preserves cache: ${rss}`, async () => {
        const res = await scrape(card, cached, fetcher(rss));
        expect(res.status).toBe("stale");
        if (res.status === "stale") expect(res.series).toEqual(cached);
      });
      test(`unusable RSS without cache fails: ${rss}`, async () => {
        expect((await scrape(card, undefined, fetcher(rss))).status).toBe("failed");
      });
    }
    test("invalid HTML warning does not invent a 403", async () => {
      const res = await scrape(card, cached, fetcher(`<channel>${item(104, 4)}</channel>`, "<html>Unexpected</html>"));
      expect(res.status).toBe("stale");
      if (res.status === "stale") {
        expect(res.error).toContain("Invalid series page HTML");
        expect(res.error).not.toContain("403");
      }
    });
    test("RSS-only cold start is degraded", async () => {
      expect((await scrape(card, undefined, fetcher(`<channel>${item(104, 4)}</channel>`))).status).toBe("stale");
    });
  });
}

test("RSS fallback remains eligible for refresh after serialization at day 30", async () => {
  const completeCard = { ...card, day: 30 };
  const result = await scrapeSeriesFull(completeCard, undefined, async url => {
    if (url.includes("/rss/series/")) return `<channel>${Array.from({ length: 30 }, (_, i) => item(101 + i, i + 1)).join("")}</channel>`;
    throw new Error("HTTP 403");
  });
  expect(result.status).toBe("stale");
  if (result.status === "failed") throw new Error("Expected RSS articles");
  let calls = 0;
  const next = await scrapeSeriesIncremental(completeCard, JSON.parse(JSON.stringify(result.series)), async () => {
    calls++;
    throw new Error("offline");
  });
  expect(calls).toBeGreaterThan(0);
  expect(next.status).toBe("stale");
});

const signup = (count: number) => Array.from({ length: count }, (_, i) => `
  <div class="list-card">
    <a href="https://ithelp.ithome.com.tw/users/1/ironman/${9038 + i}"></a>
    <div class="contestants-list__name">Author</div><div class="tag"><span>Software</span></div>
    <a class="contestants-list__title title">Series</a><p class="contestants-list__desc content">Desc</p>
    <div class="contestants-list__date date">報名日期：2026/08/01 12:00:00</div>
  </div>`).join("");


test("year output logs RSS merges as stale and preserves provenance", async () => {
  const year = await runScrape({ year: 2026, signupListUrl: "https://test/signup/list" }, {
    fetcher: async url => {
      if (url.includes("signup/list")) return signup(1);
      if (url.includes("/rss/series/")) return `<channel>${item(104, 4)}</channel>`;
      throw new Error("HTTP 403");
    },
  });
  expect(year.scrapeLog[0]).toContain("[stale] 9038: HTTP 403");
  expect(year.series[0].rssFallback).toBe(true);
});

test("successful RSS fallback allows runScrape to complete without 403 abort", async () => {
  const year = await runScrape({ year: 2026, signupListUrl: "https://test/signup/list" }, {
    concurrency: 1,
    fetcher: async url => {
      if (url.includes("signup/list")) return signup(10);
      if (url.includes("/rss/series/")) return `<channel>${item(104, 4)}</channel>`;
      throw new Error("HTTP 403");
    },
  });
  expect(year.series.length).toBe(10);
  expect(year.series[0].rssFallback).toBe(true);
});

test("consecutive HTTP 403 aborts scrape when RSS fallback is also unavailable", async () => {
  let blockedRequests = 0;
  await expect(runScrape({ year: 2026, signupListUrl: "https://test/signup/list" }, {
    concurrency: 1,
    fetcher: async url => {
      if (url.includes("signup/list")) return signup(10);
      blockedRequests++;
      throw new Error("HTTP 403");
    },
  })).rejects.toThrow("aborting scrape to avoid hammering iThome");
  expect(blockedRequests).toBeLessThan(20);
});

test("full HTML recovery clears persisted RSS provenance", async () => {
  const res = await scrapeSeriesIncremental(card, { ...cached, rssFallback: true }, async url => {
    if (url.includes("/rss/series/")) return "<channel></channel>";
    return `<div class="board leftside profile-main"><div class="qa-list__info qa-list__info--ironman"><span>參賽天數 0 天 ｜</span><span>共 0 篇文章 ｜</span></div></div>`;
  });
  expect(res.status).toBe("fresh");
  if (res.status !== "failed") expect(res.series.rssFallback).toBeUndefined();
});

test("legacy RSS warnings invalidate cached fast paths without editing snapshots", async () => {
  let requests = 0;
  const year = await runScrape({ year: 2026, signupListUrl: "https://test/signup/list" }, {
    cachedYearData: {
      year: 2026, updatedAt: "2026-09-05 12:00:00+08:00", groups: [],
      series: [{ ...cached, articleCount: 0, dayCount: 0, articles: [] }],
      scrapeLog: ["[warning] 9038: Cloudflare 403 on series page; updated via RSS fallback"],
    },
    fetcher: async url => {
      if (url.includes("signup/list")) return signup(1);
      requests++;
      throw new Error("offline");
    },
  });
  expect(requests).toBeGreaterThan(0);
  expect(year.scrapeLog[0]).toContain("[stale]");
  expect(year.series[0].rssFallback).toBe(true);
});

test("RSS-first incremental skips series page HTML when RSS has no new articles", async () => {
  let htmlFetched = false;
  const res = await scrapeSeriesIncremental(
    { ...card, day: 2 },
    { ...cached, rssFallback: true },
    async (url: string) => {
      if (url.includes("/rss/series/")) {
        return `<channel>${item(101, 1)}${item(102, 2)}</channel>`;
      }
      htmlFetched = true;
      throw new Error("HTML fetch should not have been called");
    },
  );
  expect(htmlFetched).toBe(false);
  expect(res.status).toBe("stale");
  if (res.status === "stale") {
    expect(res.series.articleCount).toBe(2);
    expect(res.series.articles.length).toBe(2);
  }
});

test("circuit breaker does not trip when majority of series are updated via RSS fallback", async () => {
  // 10 out of 10 series (100% > 20% limit) updated via RSS fallback
  const year = await runScrape(
    { year: 2026, signupListUrl: "https://test/signup/list" },
    {
      concurrency: 2,
      fetcher: async (url: string) => {
        if (url.includes("signup/list")) return signup(10);
        if (url.includes("/rss/series/")) return `<channel>${item(104, 4)}</channel>`;
        throw new Error("HTTP 403 (Cloudflare challenge)");
      },
      circuitBreaker: { maxStalePercent: 0.2 },
    },
  );
  expect(year.series.length).toBe(10);
  expect(year.scrapeLog.filter((l) => l.startsWith("[stale]")).length).toBe(10);
});
