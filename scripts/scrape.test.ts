// scripts/scrape.test.ts
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { YearData, Series, Article } from "./types";
import { mergeCardsAndStats, taipeiTimestamp, historyDate, writeHistorySnapshots, officialDayCount, mergeIncrementalArticles } from "./scrape";
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

  test("dayCount 語意（2026-08-19）：大量補發 → 官方 streak，非完賽（帶刺哥 30 篇/標頭 12/徽章 12）", async () => {
    // 大量補發的典型形貌：30 篇（標題 Day 1..30）、標頭參賽天數 12。
    // 標題是作者自填、會超前 streak；清單徽章在分頁後凍結 —— 兩者都不得
    // 拿來推 dayCount（舊規則 max(標頭, 去重 Day)=30 就是這樣誤判完賽）。
    const html = `
<div class="board leftside profile-main">
  <div class="qa-list__info qa-list__info--ironman subscription-group">
    <span>參賽天數 12 天 ｜</span><span>共 30 篇文章 ｜</span>
  </div>
  ${Array.from({ length: 30 }, (_, i) => {
    const day = i + 1;
    const badge = i === 0 ? 1 : 12;
    return `<div class="qa-list profile-list ir-profile-list"><div class="profile-list__condition">
      <div class="ir-qa-list__status"><span class="ir-qa-list__days ir-qa-list__days--profile ir-qa-list__days--fail">DAY ${badge}</span></div>
      <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/${10403000 + day}" class="qa-list__title-link">Day ${day}｜標題 ${day}</a></h3>
      <div class="qa-list__info"><a title="2026-08-${String(day).padStart(2, "0")} 12:00:00" class="qa-list__info-time"></a></div>
    </div></div>`;
  }).join("\n")}
  <div class="profile-pagination"><ul class="pager"><li class="disabled"><span>下一頁</span></li></ul></div>
</div>`;
    const stats = parseSeriesPage(html);
    expect(stats.dayCount).toBe(12); // 標頭（官方 streak）
    expect(stats.articles.length).toBe(30);
    // runScrape：抓最新一篇（清單最後）文章頁 → 真實 fixture 徽章 12。
    const fetchArticle = async (url: string) => {
      expect(url).toBe(stats.articles[29].url);
      return readFixture("article-page.html"); // 帶刺哥第 30 篇真實頁面
    };
    const dayOutcome = await officialDayCount(stats.dayCount, stats.articles[29].url, fetchArticle);
    expect(dayOutcome.dayCount).toBe(12); // 不是 30 —— 未完賽
  });

  test("officialDayCount：徽章治癒落後標頭／失敗退回標頭／無文章用標頭", async () => {
    const badge = (n: number) => async () =>
      `<div class="ir-article"><span class="ir-article__days-num">${n}</span></div>`;
    expect(await officialDayCount(10, "u", badge(11))).toEqual({ dayCount: 11 }); // 標頭落後 → 徽章
    expect(await officialDayCount(20, "u", badge(17))).toEqual({ dayCount: 20 }); // 徽章非最新篇 → 標頭保底
    expect(await officialDayCount(12, "u", async () => "<html>404</html>")).toEqual({
      dayCount: 12,
      warning: "article badge fetch failed, fallback to header",
    }); // 解析失敗
    expect(await officialDayCount(7, "u", async () => { throw new Error("network"); })).toEqual({
      dayCount: 7,
      warning: "article badge fetch failed, fallback to header",
    }); // 抓取失敗
    expect(await officialDayCount(5, undefined, async () => { throw new Error("不應抓"); })).toEqual({ dayCount: 5 }); // 無文章
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

describe("mergeIncrementalArticles", () => {
  const makeArt = (id: number, day: number, views: number = 10): Article => ({
    id, day, title: `Day ${day}`, url: `https://ithelp/articles/${id}`,
    publishedAt: `2026-08-${String(day).padStart(2, "0")}T10:00:00+08:00`,
    views, likes: 1, comments: 0,
  });

  test("same article count on Page 1 (10 -> 10): updates views/likes/comments", () => {
    const prevArticles = Array.from({ length: 10 }, (_, i) => makeArt(100 + i, i + 1, 10));
    const prevSeries: Series = {
      id: 1, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "T", description: "D",
      team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
      dayCount: 10, articleCount: 10, subscriptions: 0, articles: prevArticles,
    };
    // Fresh last page with updated views
    const freshPage1 = Array.from({ length: 10 }, (_, i) => makeArt(100 + i, i + 1, 50));
    const merged = mergeIncrementalArticles(prevSeries, freshPage1, 10, 1);
    expect(merged).not.toBeNull();
    expect(merged!.length).toBe(10);
    expect(merged![0].views).toBe(50);
    expect(merged![9].views).toBe(50);
  });

  test("Page boundary shift (10 -> 11): Page 2 gets 1st article, Page 1 prefix preserved", () => {
    const prevArticles = Array.from({ length: 10 }, (_, i) => makeArt(100 + i, i + 1, 10));
    const prevSeries: Series = {
      id: 1, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "T", description: "D",
      team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
      dayCount: 10, articleCount: 10, subscriptions: 0, articles: prevArticles,
    };
    const freshPage2 = [makeArt(110, 11, 5)];
    const merged = mergeIncrementalArticles(prevSeries, freshPage2, 11, 2);
    expect(merged).not.toBeNull();
    expect(merged!.length).toBe(11);
    expect(merged![0].id).toBe(100);
    expect(merged![10].id).toBe(110);
    expect(merged![10].views).toBe(5);
  });

  test("Page boundary shift (20 -> 21): Page 3 gets 1st article, Pages 1-2 prefix preserved", () => {
    const prevArticles = Array.from({ length: 20 }, (_, i) => makeArt(100 + i, i + 1, 10));
    const prevSeries: Series = {
      id: 1, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "T", description: "D",
      team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
      dayCount: 20, articleCount: 20, subscriptions: 0, articles: prevArticles,
    };
    const freshPage3 = [makeArt(120, 21, 5)];
    const merged = mergeIncrementalArticles(prevSeries, freshPage3, 21, 3);
    expect(merged).not.toBeNull();
    expect(merged!.length).toBe(21);
    expect(merged![19].id).toBe(119);
    expect(merged![20].id).toBe(120);
  });

  test("Monotonic violation: article count decreased (deleted articles) -> returns null (triggers Full Fallback)", () => {
    const prevArticles = Array.from({ length: 15 }, (_, i) => makeArt(100 + i, i + 1));
    const prevSeries: Series = {
      id: 1, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "T", description: "D",
      team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
      dayCount: 15, articleCount: 15, subscriptions: 0, articles: prevArticles,
    };
    // header count is 10 (5 posts deleted)
    const freshPage1 = Array.from({ length: 10 }, (_, i) => makeArt(100 + i, i + 1));
    expect(mergeIncrementalArticles(prevSeries, freshPage1, 10, 1)).toBeNull();
  });

  test("Multi-page leap (>1 page jump): returns null to trigger Full Fallback", () => {
    const prevArticles = Array.from({ length: 5 }, (_, i) => makeArt(100 + i, i + 1));
    const prevSeries: Series = {
      id: 1, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "T", description: "D",
      team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
      dayCount: 5, articleCount: 5, subscriptions: 0, articles: prevArticles,
    };
    // now 25 articles (lastPage is 3, jump is 3 - 1 = 2)
    const freshPage3 = Array.from({ length: 5 }, (_, i) => makeArt(120 + i, 21 + i));
    expect(mergeIncrementalArticles(prevSeries, freshPage3, 25, 3)).toBeNull();
  });

  test("Overlapping IDs on lastPage > 1 returns null to trigger Full Fallback", () => {
    const prevArticles = Array.from({ length: 10 }, (_, i) => makeArt(100 + i, i + 1));
    const prevSeries: Series = {
      id: 1, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "T", description: "D",
      team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
      dayCount: 10, articleCount: 10, subscriptions: 0, articles: prevArticles,
    };
    // Page 2 contains an ID that already existed on Page 1
    const corruptedPage2 = [makeArt(105, 11)];
    expect(mergeIncrementalArticles(prevSeries, corruptedPage2, 11, 2)).toBeNull();
  });
});
