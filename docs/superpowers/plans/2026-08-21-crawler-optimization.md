# 爬蟲效能優化與雙模式增量同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 iThome 鐵人賽爬蟲從全量序列爬取重構為「日常精準最後一頁增量同步 + 定期深度校準」雙模式體系，搭配 Worker Pool 並行控制與完整資料一致性契約，將 CI 執行時間從 4 分鐘縮短至 30 秒內，並降低 50%~55% 請求量。

**Architecture:** 
日常預設模式載入本地前次 `data/{year}.json` 作為快取，透過 RSS 探測總篇數並直接定位最後一頁分頁，解析最新文章互動數據（閱讀數/按讚數/留言數）並以 Article ID Identity Map 進行安全合併；任何篇數不符或 ID 異常一律退回 Full Fallback；深度校準模式（`--full`）與獨立排程則遍歷所有分頁全面校準歷史文章。

**Tech Stack:** TypeScript, Bun, Bun Test, GitHub Actions, Cloudflare Pages

## Global Constraints

- **型別系統與資料契約相容**：產出之 `YearData`、`Series`、`Article`、`MetaJson` 與前端（`web/`）資料合約 100% 向後相容。
- **資料排序契約**：`articles` 陣列最終排序嚴格保持 `articles.sort((a, b) => a.day - b.day)`。
- **失敗與狀態模型契約**：爬取結果嚴格區分為 `fresh`、`stale`、`failed`，`failed` 系列絕不加入 `YearData.series`，`stale` 需寫入 `[stale]` 日誌，badge 異常需寫入 `[warning]` 日誌。
- **Workflow 競態防護**：所有資料更新 workflow 皆共用 `concurrency: group: data-update-main, cancel-in-progress: false`。

---

### Task 1: Type Definitions and Page Validity Validators

**Files:**
- Modify: `scripts/types.ts`
- Modify: `scripts/parse-series.ts`
- Test: `scripts/parse-series.test.ts`

**Interfaces:**
- Produces:
  - `SeriesResult`: `{ status: "fresh"; series: Series; warnings?: string[] } | { status: "stale"; series: Series; error: string } | { status: "failed"; seriesId: number; error: string }`
  - `OfficialDayCountResult`: `{ dayCount: number; warning?: string }`
  - `isSeriesPage(html: string): boolean`
  - `isArticlePage(html: string): boolean`

- [ ] **Step 1: Write failing tests for `isSeriesPage` and `isArticlePage` in `scripts/parse-series.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { isSeriesPage, isArticlePage } from "./parse-series";
import { readFixture } from "./test-utils";

describe("Page validity validators", () => {
  test("isSeriesPage: valid normal series fixture returns true", () => {
    const html = readFixture("series-page.html");
    expect(isSeriesPage(html)).toBe(true);
  });

  test("isSeriesPage: valid 0-article series page returns true", () => {
    const html = `
      <div class="board leftside profile-main">
        <div class="qa-list__info qa-list__info--ironman subscription-group">
          <span>參賽天數 0 天 ｜</span><span>共 0 篇文章 ｜</span>
        </div>
      </div>`;
    expect(isSeriesPage(html)).toBe(true);
  });

  test("isSeriesPage: challenge / error / empty HTML returns false", () => {
    expect(isSeriesPage("<html><body>Just a moment...</body></html>")).toBe(false);
    expect(isSeriesPage("<div>500 Internal Server Error</div>")).toBe(false);
    expect(isSeriesPage("")).toBe(false);
  });

  test("isArticlePage: valid article fixture returns true", () => {
    const html = readFixture("article-page.html");
    expect(isArticlePage(html)).toBe(true);
  });

  test("isArticlePage: challenge / error returns false", () => {
    expect(isArticlePage("<html><body>Challenge</body></html>")).toBe(false);
    expect(isArticlePage("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/parse-series.test.ts`
Expected: FAIL (`isSeriesPage` is not exported from `./parse-series`)

- [ ] **Step 3: Update `scripts/types.ts` and implement validators in `scripts/parse-series.ts`**

In `scripts/types.ts`:
```ts
export type SeriesResult =
  | { status: "fresh"; series: Series; warnings?: string[] }
  | { status: "stale"; series: Series; error: string }
  | { status: "failed"; seriesId: number; error: string };

export type OfficialDayCountResult = {
  dayCount: number;
  warning?: string;
};
```

In `scripts/parse-series.ts`:
```ts
export function isSeriesPage(html: string): boolean {
  if (!html || typeof html !== "string") return false;
  const hasHeader = /參賽天數\s*\d+\s*天/.test(html) && /共\s*\d+\s*篇文章/.test(html);
  const hasContainer = html.includes("qa-list__info") || html.includes("profile-main") || html.includes("ir-profile-list");
  return hasHeader && hasContainer;
}

export function isArticlePage(html: string): boolean {
  if (!html || typeof html !== "string") return false;
  return html.includes("ir-article") || html.includes("qa-markdown");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/parse-series.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/types.ts scripts/parse-series.ts scripts/parse-series.test.ts
git commit -m "feat: add SeriesResult types and page validity validators"
```

---

### Task 2: Rate Limiter & Concurrency Worker Pool Helper

**Files:**
- Create: `scripts/rate-limiter.ts`
- Test: `scripts/rate-limiter.test.ts`

**Interfaces:**
- Produces:
  - `pMap<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>, opts: { concurrency?: number; delayMs?: number }): Promise<R[]>`

- [ ] **Step 1: Write failing test in `scripts/rate-limiter.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { pMap } from "./rate-limiter";

describe("pMap concurrency limiter", () => {
  test("processes all items and preserves input order", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = await pMap(items, async (x) => x * 2, { concurrency: 3 });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  test("enforces concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 15 }, (_, i) => i);
    await pMap(
      items,
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
      },
      { concurrency: 4 },
    );
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  test("handles empty list", async () => {
    const res = await pMap([], async (x) => x);
    expect(res).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/rate-limiter.test.ts`
Expected: FAIL (`Cannot find module ./rate-limiter`)

- [ ] **Step 3: Implement `pMap` in `scripts/rate-limiter.ts`**

```ts
// scripts/rate-limiter.ts

export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: { concurrency?: number; delayMs?: number } = {},
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const delayMs = opts.delayMs ?? 0;
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
      if (delayMs > 0 && nextIndex < items.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/rate-limiter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/rate-limiter.ts scripts/rate-limiter.test.ts
git commit -m "feat: add pMap concurrency worker pool helper"
```

---

### Task 3: Official Day Count Badge & Warning Propagation

**Files:**
- Modify: `scripts/scrape.ts`
- Modify: `scripts/scrape.test.ts`

**Interfaces:**
- Consumes: `isArticlePage` from `scripts/parse-series.ts`, `OfficialDayCountResult` from `scripts/types.ts`
- Produces: `officialDayCount(headerDays: number, latestArticleUrl: string | undefined, fetchArticle?: (url: string) => Promise<string>): Promise<OfficialDayCountResult>`

- [ ] **Step 1: Update failing tests for `officialDayCount` in `scripts/scrape.test.ts`**

In `scripts/scrape.test.ts`:
```ts
test("officialDayCount returns dayCount and warning when article fetch fails", async () => {
  const failingFetch = async () => {
    throw new Error("network timeout");
  };
  const res = await officialDayCount(12, "https://ithelp.ithome.com.tw/articles/104000", failingFetch);
  expect(res.dayCount).toBe(12);
  expect(res.warning).toContain("badge fetch failed, fallback to header");
});

test("officialDayCount returns dayCount and warning when page is invalid HTML", async () => {
  const invalidFetch = async () => "<html>Challenge</html>";
  const res = await officialDayCount(12, "https://ithelp.ithome.com.tw/articles/104000", invalidFetch);
  expect(res.dayCount).toBe(12);
  expect(res.warning).toContain("badge fetch failed, fallback to header");
});

test("officialDayCount returns dayCount without warning on successful badge fetch", async () => {
  const validFetch = async () => '<div class="ir-article"><div class="ir-article__days-num">15</div></div>';
  const res = await officialDayCount(12, "https://ithelp.ithome.com.tw/articles/104000", validFetch);
  expect(res.dayCount).toBe(15);
  expect(res.warning).toBeUndefined();
});

test("officialDayCount returns headerDays without warning if latestArticleUrl is undefined", async () => {
  const res = await officialDayCount(5, undefined);
  expect(res.dayCount).toBe(5);
  expect(res.warning).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/scrape.test.ts`
Expected: FAIL (type mismatch: expected `{ dayCount, warning }`, received `number`)

- [ ] **Step 3: Update `officialDayCount` implementation in `scripts/scrape.ts`**

```ts
import { isArticlePage } from "./parse-series";
import type { OfficialDayCountResult } from "./types";

export async function officialDayCount(
  headerDays: number,
  latestArticleUrl: string | undefined,
  fetchArticle: (url: string) => Promise<string> = fetchHtml,
): Promise<OfficialDayCountResult> {
  if (!latestArticleUrl) return { dayCount: headerDays };
  try {
    const html = await fetchArticle(latestArticleUrl);
    if (!isArticlePage(html)) {
      return { dayCount: headerDays, warning: "article badge fetch failed, fallback to header" };
    }
    const badge = parseArticleDay(html);
    return { dayCount: Math.max(headerDays, badge ?? 0) };
  } catch {
    return { dayCount: headerDays, warning: "article badge fetch failed, fallback to header" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/scrape.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/scrape.ts scripts/scrape.test.ts
git commit -m "feat: propagate warnings in officialDayCount"
```

---

### Task 4: Incremental Merge Engine & Postconditions

**Files:**
- Modify: `scripts/scrape.ts`
- Modify: `scripts/scrape.test.ts`

**Interfaces:**
- Produces: `mergeIncrementalArticles(prev: Series, lastPageArticles: Article[], headerArticleCount: number, lastPage: number): Article[] | null`

- [ ] **Step 1: Write comprehensive failing tests for `mergeIncrementalArticles` in `scripts/scrape.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/scrape.test.ts`
Expected: FAIL (`mergeIncrementalArticles` is not defined)

- [ ] **Step 3: Implement `mergeIncrementalArticles` in `scripts/scrape.ts`**

```ts
export function mergeIncrementalArticles(
  prev: Series,
  lastPageArticles: Article[],
  headerArticleCount: number,
  lastPage: number,
): Article[] | null {
  // Safety Invariants
  if (!prev || prev.articles.length !== prev.articleCount || prev.articleCount <= 0) {
    return null;
  }
  if (headerArticleCount < prev.articleCount) {
    return null; // Monotonic violation (articles deleted) -> full sync
  }
  const prevLastPage = Math.ceil(prev.articleCount / 10);
  if (lastPage - prevLastPage > 1) {
    return null; // Multi-page leap -> full sync
  }

  const prefixLength = (lastPage - 1) * 10;
  if (prefixLength > prev.articles.length) {
    return null;
  }
  const prefixArticles = prev.articles.slice(0, prefixLength);
  if (prefixArticles.length !== prefixLength) {
    return null;
  }

  // Non-overlapping check when lastPage > 1
  if (lastPage > 1) {
    const prefixIdSet = new Set(prefixArticles.map((a) => a.id));
    for (const art of lastPageArticles) {
      if (prefixIdSet.has(art.id)) return null; // Overlapping ID detected
    }
  }

  const byId = new Map<number, Article>();
  for (const a of prefixArticles) byId.set(a.id, a);
  for (const a of lastPageArticles) byId.set(a.id, a);

  const merged = [...byId.values()].sort((a, b) => a.day - b.day);

  // Postconditions Check
  if (merged.length !== headerArticleCount) return null;
  if (new Set(merged.map((a) => a.id)).size !== merged.length) return null;

  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/scrape.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/scrape.ts scripts/scrape.test.ts
git commit -m "feat: implement mergeIncrementalArticles with postconditions"
```

---

### Task 5: Dual-Mode Series Scrapers (`scrapeSeriesIncremental` & `scrapeSeriesFull`)

**Files:**
- Modify: `scripts/scrape.ts`
- Modify: `scripts/scrape.test.ts`

**Interfaces:**
- Consumes: `mergeIncrementalArticles`, `officialDayCount`, `isSeriesPage`, `parseRss`, `parseSeriesPage`, `pMap`
- Produces:
  - `scrapeSeriesIncremental(card: SignupCard, cachedSeries?: Series, fetcher?: FetchFn): Promise<SeriesResult>`
  - `scrapeSeriesFull(card: SignupCard, cachedSeries?: Series, fetcher?: FetchFn): Promise<SeriesResult>`

- [ ] **Step 1: Write failing unit tests for series scrapers and fallback scenarios in `scripts/scrape.test.ts`**

```ts
describe("scrapeSeriesIncremental and scrapeSeriesFull", () => {
  const card: SignupCard = {
    seriesId: 9029, userId: 20183319, name: "Tim", group: "Software", title: "AI", description: "desc",
    team: null, signupDate: "2026-08-01 12:00:00", day: 10,
  };

  test("cold start with 0 articles emits fresh pending series without series page fetch", async () => {
    const rssXml = `<channel><lastBuildDate>Fri, 01 Aug 2026 12:00:00 +0800</lastBuildDate></channel>`;
    const seriesPageHtml = `
      <div class="board leftside profile-main">
        <div class="qa-list__info qa-list__info--ironman">
          <span>參賽天數 0 天 ｜</span><span>共 0 篇文章 ｜</span>
        </div>
      </div>`;
    const fetcher = async (url: string) => {
      if (url.includes("/rss/series/")) return rssXml;
      return seriesPageHtml;
    };
    const res = await scrapeSeriesIncremental(card, undefined, fetcher);
    expect(res.status).toBe("fresh");
    if (res.status === "fresh") {
      expect(res.series.articleCount).toBe(0);
      expect(res.series.dayCount).toBe(0);
      expect(res.series.articles).toEqual([]);
    }
  });

  test("RSS 0 items with existing cache triggers verification and preserves cache if RSS was glitch", async () => {
    const prevSeries: Series = {
      id: 9029, user: { id: 20183319, name: "Tim", profileUrl: "p" }, group: "Software", title: "AI", description: "desc",
      team: null, signupDate: "2026-08-01T12:00:00+08:00", lastUpdated: null,
      dayCount: 10, articleCount: 10, subscriptions: 0,
      articles: Array.from({ length: 10 }, (_, i) => ({
        id: 100 + i, day: i + 1, title: `D${i+1}`, url: "u", publishedAt: "2026-08-01T10:00:00+08:00",
        views: 10, likes: 0, comments: 0,
      })),
    };
    // RSS returns 0 items, series page fetch fails with 500
    const fetcher = async (url: string) => {
      if (url.includes("/rss/series/")) return `<channel></channel>`;
      throw new Error("500 internal server error");
    };
    const res = await scrapeSeriesIncremental(card, prevSeries, fetcher);
    expect(res.status).toBe("stale");
    if (res.status === "stale") {
      expect(res.series.articleCount).toBe(10);
      expect(res.error).toBeDefined();
    }
  });

  test("RSS failure with no cache emits failed result (does not create 0-stat series)", async () => {
    const fetcher = async () => {
      throw new Error("network timeout");
    };
    const res = await scrapeSeriesIncremental(card, undefined, fetcher);
    expect(res.status).toBe("failed");
    if (res.status === "failed") {
      expect(res.seriesId).toBe(card.seriesId);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/scrape.test.ts`
Expected: FAIL (`scrapeSeriesIncremental` is not defined)

- [ ] **Step 3: Implement `scrapeSeriesFull` and `scrapeSeriesIncremental` in `scripts/scrape.ts`**

```ts
export type FetchFn = (url: string) => Promise<string>;

export async function scrapeSeriesFull(
  card: SignupCard,
  cachedSeries?: Series,
  fetcher: FetchFn = fetchHtml,
): Promise<SeriesResult> {
  try {
    let rssChannel: RssChannel | null = null;
    try {
      const rssXml = await fetcher(rssUrl(card.seriesId));
      rssChannel = parseRss(rssXml);
    } catch { /* best-effort */ }

    const firstPageHtml = await fetcher(seriesUrl(card.userId, card.seriesId));
    if (!isSeriesPage(firstPageHtml)) {
      throw new Error("Invalid series page HTML");
    }

    const first = parseSeriesPage(firstPageHtml);
    const articles = [...first.articles];
    let page: string | null = first.nextPage;

    while (page && articles.length < first.articleCount) {
      const pageHtml = await fetcher(seriesUrl(card.userId, card.seriesId) + page);
      if (!isSeriesPage(pageHtml)) {
        throw new Error(`Invalid series page HTML at ${page}`);
      }
      const parsed = parseSeriesPage(pageHtml);
      articles.push(...parsed.articles);
      page = parsed.nextPage;
    }

    if (first.articleCount > 0 && articles.length !== first.articleCount) {
      throw new Error(`Articles collected (${articles.length}) mismatch header (${first.articleCount})`);
    }

    let dayCount = first.dayCount;
    const warnings: string[] = [];
    if (articles.length > 0) {
      const latestUrl = articles[articles.length - 1]?.url;
      const dayRes = await officialDayCount(first.dayCount, latestUrl, fetcher);
      dayCount = dayRes.dayCount;
      if (dayRes.warning) warnings.push(dayRes.warning);
    }

    const latestPub = articles[articles.length - 1]?.publishedAt ?? null;
    const lastUpdated = rssChannel?.lastBuildDate ?? latestPub;

    const series: Series = {
      id: card.seriesId,
      user: { id: card.userId, name: card.name, profileUrl: `https://ithelp.ithome.com.tw/users/${card.userId}/profile` },
      group: card.group,
      title: card.title,
      description: card.description,
      team: card.team,
      signupDate: card.signupDate.replace(" ", "T") + "+08:00",
      lastUpdated,
      dayCount,
      articleCount: first.articleCount,
      subscriptions: first.subscriptions,
      articles: articles.sort((a, b) => a.day - b.day),
    };

    return { status: "fresh", series, warnings: warnings.length > 0 ? warnings : undefined };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    if (cachedSeries) {
      return { status: "stale", series: cachedSeries, error: errorMsg };
    }
    return { status: "failed", seriesId: card.seriesId, error: errorMsg };
  }
}

export async function scrapeSeriesIncremental(
  card: SignupCard,
  cachedSeries?: Series,
  fetcher: FetchFn = fetchHtml,
): Promise<SeriesResult> {
  try {
    let rssXml: string;
    try {
      rssXml = await fetcher(rssUrl(card.seriesId));
    } catch {
      return await scrapeSeriesFull(card, cachedSeries, fetcher);
    }

    const rss = parseRss(rssXml);
    const nHint = rss.items.length;

    // RSS 0 items protection
    if (nHint === 0) {
      if (cachedSeries && cachedSeries.articleCount > 0) {
        return await scrapeSeriesFull(card, cachedSeries, fetcher);
      }
      const page1Html = await fetcher(seriesUrl(card.userId, card.seriesId));
      if (isSeriesPage(page1Html)) {
        const parsed = parseSeriesPage(page1Html);
        if (parsed.articleCount === 0) {
          const series: Series = {
            id: card.seriesId,
            user: { id: card.userId, name: card.name, profileUrl: `https://ithelp.ithome.com.tw/users/${card.userId}/profile` },
            group: card.group, title: card.title, description: card.description, team: card.team,
            signupDate: card.signupDate.replace(" ", "T") + "+08:00",
            lastUpdated: null, dayCount: 0, articleCount: 0, subscriptions: parsed.subscriptions, articles: [],
          };
          return { status: "fresh", series };
        }
      }
      return await scrapeSeriesFull(card, cachedSeries, fetcher);
    }

    const lastPage = Math.ceil(nHint / 10);
    const lastPageUrl = `${seriesUrl(card.userId, card.seriesId)}${lastPage === 1 ? "" : `?page=${lastPage}`}`;
    const lastPageHtml = await fetcher(lastPageUrl);
    if (!isSeriesPage(lastPageHtml)) {
      throw new Error("Invalid series last page HTML");
    }

    const parsedLastPage = parseSeriesPage(lastPageHtml);
    const headerArticleCount = parsedLastPage.articleCount;

    // Validate that fetched page is indeed the true last page
    if (Math.ceil(headerArticleCount / 10) !== lastPage) {
      return await scrapeSeriesFull(card, cachedSeries, fetcher);
    }

    if (!cachedSeries) {
      return await scrapeSeriesFull(card, undefined, fetcher);
    }

    const mergedArticles = mergeIncrementalArticles(cachedSeries, parsedLastPage.articles, headerArticleCount, lastPage);
    if (!mergedArticles) {
      return await scrapeSeriesFull(card, cachedSeries, fetcher);
    }

    let dayCount = cachedSeries.dayCount;
    const warnings: string[] = [];

    // If new posts exist, fetch latest article page to compute dayCount
    if (headerArticleCount > cachedSeries.articleCount && mergedArticles.length > 0) {
      const latestUrl = mergedArticles[mergedArticles.length - 1]?.url;
      const dayRes = await officialDayCount(parsedLastPage.dayCount, latestUrl, fetcher);
      dayCount = dayRes.dayCount;
      if (dayRes.warning) warnings.push(dayRes.warning);
    }

    const latestPub = mergedArticles[mergedArticles.length - 1]?.publishedAt ?? null;
    const lastUpdated = rss.lastBuildDate ?? latestPub;

    const series: Series = {
      id: card.seriesId,
      user: { id: card.userId, name: card.name, profileUrl: `https://ithelp.ithome.com.tw/users/${card.userId}/profile` },
      group: card.group,
      title: card.title,
      description: card.description,
      team: card.team,
      signupDate: card.signupDate.replace(" ", "T") + "+08:00",
      lastUpdated,
      dayCount,
      articleCount: headerArticleCount,
      subscriptions: parsedLastPage.subscriptions,
      articles: mergedArticles,
    };

    return { status: "fresh", series, warnings: warnings.length > 0 ? warnings : undefined };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    if (cachedSeries) {
      return { status: "stale", series: cachedSeries, error: errorMsg };
    }
    return { status: "failed", seriesId: card.seriesId, error: errorMsg };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/scrape.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/scrape.ts scripts/scrape.test.ts
git commit -m "feat: implement dual-mode series scrapers with safe fallback"
```

---

### Task 6: CLI Flags, Atomic Writes & Aggregation Integration

**Files:**
- Modify: `scripts/scrape.ts`
- Modify: `scripts/scrape-cli.test.ts`

**Interfaces:**
- Produces:
  - `runScrape(manifest: Manifest, opts?: { full?: boolean; cachedYearData?: YearData; concurrency?: number }): Promise<YearData>`
  - CLI execution with `--full` flag support

- [ ] **Step 1: Write failing tests in `scripts/scrape-cli.test.ts`**

```ts
test("runScrape aggregates fresh and stale into series and logs errors", async () => {
  const manifest: Manifest = { year: 2026, signupListUrl: "https://x/2026" };
  const mockSignup = '<div class="list-card"><a href="/users/1/ironman/100"></a><span class="contestants-list__name">A</span><div class="tag"><span>G</span></div><h3 class="contestants-list__title">T</h3><p class="contestants-list__desc">D</p><span class="signup-date">報名日期：2026/08/01 12:00:00</span></div>';
  // ... mock scrapers
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/scrape-cli.test.ts`
Expected: FAIL

- [ ] **Step 3: Refactor `runScrape` and CLI entry in `scripts/scrape.ts`**

In `scripts/scrape.ts`:
```ts
export async function runScrape(
  manifest: Manifest,
  opts: { full?: boolean; cachedYearData?: YearData; concurrency?: number } = {},
): Promise<YearData> {
  const isFull = opts.full ?? false;
  const concurrency = opts.concurrency ?? 5;
  const cachedMap = new Map<number, Series>();
  if (opts.cachedYearData?.series) {
    for (const s of opts.cachedYearData.series) cachedMap.set(s.id, s);
  }

  // 1. fetch all pages of signup list
  const cards: SignupCard[] = [];
  let page = 1;
  for (;;) {
    const url = `${manifest.signupListUrl}${page === 1 ? "" : `?page=${page}`}`;
    const html = await fetchHtml(url);
    const parsed = parseSignupList(html);
    if (parsed.length === 0) break;
    cards.push(...parsed);
    if (!/rel="next"/.test(html)) break;
    page++;
  }

  // 2. per series worker pool
  const scrapeLog: string[] = [];
  const results = await pMap(
    cards,
    async (card) => {
      const cached = cachedMap.get(card.seriesId);
      if (isFull) {
        return await scrapeSeriesFull(card, cached, fetchHtml);
      }
      return await scrapeSeriesIncremental(card, cached, fetchHtml);
    },
    { concurrency, delayMs: 20 },
  );

  const series: Series[] = [];
  for (const res of results) {
    if (res.status === "fresh") {
      series.push(res.series);
      if (res.warnings) {
        for (const w of res.warnings) scrapeLog.push(`[warning] ${res.series.id}: ${w}`);
      }
    } else if (res.status === "stale") {
      series.push(res.series);
      scrapeLog.push(`[stale] ${res.series.id}: ${res.error}`);
    } else if (res.status === "failed") {
      scrapeLog.push(`[failed] ${res.seriesId}: ${res.error}`);
    }
  }

  series.sort((a, b) => b.dayCount - a.dayCount || a.signupDate.localeCompare(b.signupDate));
  const groups = [...new Set(series.map((s) => s.group))].sort();

  return {
    year: manifest.year,
    updatedAt: taipeiTimestamp(new Date()),
    groups,
    series,
    scrapeLog,
  };
}
```

Update CLI entry in `scripts/scrape.ts`:
```ts
if (import.meta.main) {
  const isFull = process.argv.includes("--full");
  const manifestPath = join(import.meta.dir, "..", "config", "series-manifest.json");
  const manifests: Manifest[] = JSON.parse(await readFile(manifestPath, "utf-8"));
  // ...
  const dataDir = join(import.meta.dir, "..", "data");
  await mkdir(dataDir, { recursive: true });

  const { succeeded, failures } = await collectYears(manifests, async (m) => {
    let cached: YearData | undefined;
    if (!isFull) {
      try {
        const raw = await readFile(join(dataDir, `${m.year}.json`), "utf-8");
        cached = JSON.parse(raw);
      } catch { /* cold start */ }
    }
    return runScrape(m, { full: isFull, cachedYearData: cached });
  });
  // ...
}
```

- [ ] **Step 4: Run all scraper tests**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/scrape.ts scripts/scrape-cli.test.ts
git commit -m "feat: wire up dual-mode runScrape and CLI --full flag"
```

---

### Task 7: GitHub Actions Workflows Update & Deep Calibrate Workflow

**Files:**
- Modify: `.github/workflows/scheduled-update.yml`
- Create: `.github/workflows/deep-calibrate.yml`

- [ ] **Step 1: Update `.github/workflows/scheduled-update.yml` with step conditionals and concurrency group**

```yaml
name: scheduled-update
on:
  workflow_dispatch: {}

concurrency:
  group: data-update-main
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Scrape (Incremental)
        run: bun run scripts/scrape.ts

      - name: Commit data if changed
        id: commit
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/ web/public/data/
          if git diff --cached --quiet; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            echo "no data change; skipping commit+build+deploy"
            exit 0
          fi
          echo "changed=true" >> "$GITHUB_OUTPUT"
          git commit -m "chore: update ironman data $(date -u +%Y-%m-%dT%H:%MZ)"

          for attempt in 1 2 3 4 5; do
            if git pull --rebase origin main && git push origin main; then
              exit 0
            fi
            sleep 5
          done
          echo "push failed after rebase retries" >&2
          exit 1

      - name: Build site
        if: steps.commit.outputs.changed == 'true'
        run: cd web && bun install && bun run build

      - name: Deploy to Cloudflare Pages
        if: steps.commit.outputs.changed == 'true'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler pages deploy web/dist --project-name=ironman-observer-next
```

- [ ] **Step 2: Create `.github/workflows/deep-calibrate.yml`**

```yaml
name: deep-calibrate
on:
  schedule:
    - cron: "15 */2 * * *"
  workflow_dispatch: {}

concurrency:
  group: data-update-main
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  calibrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Scrape (Full Calibration)
        run: bun run scripts/scrape.ts --full

      - name: Commit data if changed
        id: commit
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/ web/public/data/
          if git diff --cached --quiet; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            echo "no data change; skipping commit+build+deploy"
            exit 0
          fi
          echo "changed=true" >> "$GITHUB_OUTPUT"
          git commit -m "chore: deep calibrate ironman data $(date -u +%Y-%m-%dT%H:%MZ)"

          for attempt in 1 2 3 4 5; do
            if git pull --rebase origin main && git push origin main; then
              exit 0
            fi
            sleep 5
          done
          echo "push failed after rebase retries" >&2
          exit 1

      - name: Build site
        if: steps.commit.outputs.changed == 'true'
        run: cd web && bun install && bun run build

      - name: Deploy to Cloudflare Pages
        if: steps.commit.outputs.changed == 'true'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler pages deploy web/dist --project-name=ironman-observer-next
```

- [ ] **Step 3: Verify with full suite test and build**

Run: `bun test && cd web && bun run build`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scheduled-update.yml .github/workflows/deep-calibrate.yml
git commit -m "ci: update scheduled-update and add deep-calibrate workflow"
```
