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
    const fetcher = (rss: string) => async (url: string) => {
      if (url.includes("/rss/series/")) return rss;
      throw new Error(`unexpected URL ${url}`);
    };

    test("merges RSS articles cleanly with cached articles", async () => {
      const res = await scrape(card, cached, fetcher(`<channel>${item(102, 2)}${item(104, 4)}</channel>`));
      expect(res.status).toBe("fresh");
      if (res.status !== "fresh") throw new Error("Expected fresh result");
      expect(res.series.articles.map(a => a.id)).toEqual([101, 102, 104]);
      expect(res.series.articleCount).toBe(3);
      expect(res.series.dayCount).toBe(4);
      expect(res.series.articles[1].views).toBe(42);
      expect(res.series.articles[2].views).toBeUndefined();
      expect(res.series.subscriptions).toBe(5);
    });

    for (const rss of ["<channel></channel>", "<channel><item><title>Bad link</title><link>invalid</link></item></channel>"]) {
      test(`unusable RSS preserves cache: ${rss}`, async () => {
        const res = await scrape(card, cached, fetcher(rss));
        expect(res.status).toBe("stale");
        if (res.status === "stale") expect(res.series).toEqual(cached);
      });
      test(`unusable RSS without cache fails: ${rss}`, async () => {
        expect((await scrape(card, undefined, fetcher(rss))).status).toBe("failed");
      });
    }

    test("RSS cold start succeeds and marks status fresh", async () => {
      const res = await scrape(card, undefined, fetcher(`<channel>${item(104, 4)}</channel>`));
      expect(res.status).toBe("fresh");
      if (res.status === "fresh") {
        expect(res.series.articles.length).toBe(1);
        expect(res.series.articles[0].id).toBe(104);
      }
    });
  });
}

const signup = (count: number) => Array.from({ length: count }, (_, i) => `
  <div class="list-card">
    <a href="https://ithelp.ithome.com.tw/users/1/ironman/${9038 + i}"></a>
    <div class="contestants-list__name">Author</div><div class="tag"><span>Software</span></div>
    <a class="contestants-list__title title">Series</a><p class="contestants-list__desc content">Desc</p>
    <div class="contestants-list__date date">報名日期：2026/08/01 12:00:00</div>
    <div class="team-dashboard__box">
      <label class="note team-dashboard__day">DAY 4</label>
    </div>
  </div>`).join("");

test("successful RSS scrape completes runScrape with fresh series", async () => {
  const year = await runScrape({ year: 2026, signupListUrl: "https://test/signup/list" }, {
    concurrency: 2,
    fetcher: async url => {
      if (url.includes("signup/list")) return signup(5);
      if (url.includes("/rss/series/")) return `<channel>${item(104, 4)}</channel>`;
      throw new Error("unexpected URL");
    },
  });
  expect(year.series.length).toBe(5);
  expect(year.scrapeLog.length).toBe(0);
  expect(year.series[0].articleCount).toBe(1);
});

test("consecutive HTTP 403 aborts scrape when network is blocked", async () => {
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

test("circuit breaker does not trip when series are cleanly updated via RSS", async () => {
  const year = await runScrape(
    { year: 2026, signupListUrl: "https://test/signup/list" },
    {
      concurrency: 2,
      fetcher: async (url: string) => {
        if (url.includes("signup/list")) return signup(10);
        if (url.includes("/rss/series/")) return `<channel>${item(104, 4)}</channel>`;
        throw new Error("unexpected URL");
      },
      circuitBreaker: { maxStalePercent: 0.2 },
    },
  );
  expect(year.series.length).toBe(10);
  expect(year.scrapeLog.filter((l) => l.startsWith("[stale]")).length).toBe(0);
});
