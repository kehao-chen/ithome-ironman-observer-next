// scripts/scrape.ts
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHtml } from "./fetch-html";
import { pMap } from "./rate-limiter";
import { parseSignupList } from "./parse-signup";
import { parseRss, rssUrl } from "./parse-rss";
import { parseSeriesPage, seriesUrl, isArticlePage, isSeriesPage } from "./parse-series";
import { parseArticleDay } from "./parse-article";
import type { Manifest, Series, SignupCard, YearData, SeriesStats, RssChannel, MetaJson, OfficialDayCountResult, Article, SeriesResult } from "./types";

export function mergeCardsAndStats(
  cards: SignupCard[],
  statsBySeries: Map<number, SeriesStats>,
  rssBySeries: Map<number, RssChannel>,
): Series[] {
  const series: Series[] = cards.map((c) => {
    const st = statsBySeries.get(c.seriesId);
    const rss = rssBySeries.get(c.seriesId);
    return {
      id: c.seriesId,
      user: { id: c.userId, name: c.name, profileUrl: `https://ithelp.ithome.com.tw/users/${c.userId}/profile` },
      group: c.group,
      title: c.title,
      description: c.description,
      team: c.team,
      signupDate: `${c.signupDate.replace(" ", "T")}+08:00`,
      lastUpdated: rss?.lastBuildDate ?? null, // spec: 更新時間 card field
      dayCount: st?.dayCount ?? 0,
      articleCount: st?.articleCount ?? 0,
      subscriptions: st?.subscriptions ?? 0,
      articles: (st?.articles ?? []).sort((a, b) => a.day - b.day),
    };
  });
  series.sort((a, b) => b.dayCount - a.dayCount || a.signupDate.localeCompare(b.signupDate));
  return series;
}
// 系列當前官方參賽天數（＝連續發文天數）。權威值 = 最新一篇文章頁的
// ir-article__days 徽章（該篇發佈時的官方 streak；大量補發不會增加——
// 帶刺哥 9128 補滿 30 篇後徽章/標頭仍凍結在 12，只有標題自填 Day 30）。
// 與系列頁標頭取 max：兩者皆官方值，任一方落後時互補（標頭快取舊值 →
// 徽章治癒；徽章抓到的非最新篇 → 標頭保底）。徽章缺席（無文章、文章頁
// 抓取或解析失敗）→ 只用標頭；fetchArticle 可注入（測試接縫）。
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

export function mergeIncrementalArticles(
  prev: Series,
  lastPageArticles: Article[],
  headerArticleCount: number,
  lastPage: number,
): Article[] | null {
  // Safety Invariants
  if (!prev || !Array.isArray(prev.articles) || prev.articles.length !== prev.articleCount || prev.articleCount <= 0) {
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
      signupDate: `${card.signupDate.replace(" ", "T")}+08:00`,
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
  // Fast path 1: series is already completed (dayCount >= 30, articleCount >= 30, card.day >= 30)
  // Ironman series complete at 30 days. No new articles can be posted.
  if (
    cachedSeries &&
    cachedSeries.dayCount >= 30 &&
    cachedSeries.articleCount >= 30 &&
    cachedSeries.articles.length >= 30 &&
    card.day >= 30
  ) {
    return { status: "fresh", series: cachedSeries };
  }

  // Fast path 2: series has not started yet (card.day === 0 and cached articleCount === 0)
  // The signup card explicitly shows DAY 0; no posts have been created yet.
  if (
    cachedSeries &&
    cachedSeries.articleCount === 0 &&
    cachedSeries.dayCount === 0 &&
    card.day === 0
  ) {
    return { status: "fresh", series: cachedSeries };
  }

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
            signupDate: `${card.signupDate.replace(" ", "T")}+08:00`,
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

    let dayCount = Math.max(cachedSeries.dayCount, parsedLastPage.dayCount);
    const warnings: string[] = [];

    // If new posts exist, fetch latest article page to compute dayCount
    if (headerArticleCount > cachedSeries.articleCount && mergedArticles.length > 0) {
      const latestUrl = mergedArticles[mergedArticles.length - 1]?.url;
      const dayRes = await officialDayCount(parsedLastPage.dayCount, latestUrl, fetcher);
      dayCount = Math.max(dayCount, dayRes.dayCount);
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
      signupDate: `${card.signupDate.replace(" ", "T")}+08:00`,
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

// Emit the real Taipei wall clock (UTC+8, no DST) as ISO +08:00.
// Naive `new Date().toISOString().replace("Z","+08:00")` relabels UTC digits
// as +08:00 without shifting — 8h stale. Shift first, then stamp.
export function taipeiTimestamp(d: Date): string {
  return `${new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ")}+08:00`;
}

export function historyDate(updatedAt: string): string {
  return updatedAt.slice(0, 10); // 臺北日期 = updatedAt 前 10 字元（+08:00 牆鐘）
}

export async function writeHistorySnapshots(dataDir: string, years: YearData[]): Promise<string[]> {
  const failures: string[] = [];
  for (const data of years) {
    try {
      const dir = join(dataDir, "history", String(data.year));
      const path = join(dir, `${historyDate(data.updatedAt)}.json`);
      await mkdir(dir, { recursive: true });
      const content = JSON.stringify(data, null, 2);
      try {
        const existing = await readFile(path, "utf-8");
        if (existing === content) continue; // 相同內容跳過（無變更不 commit）
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await writeFile(path, content);
    } catch (e) {
      // 單一年度失敗：記錄並繼續其他年度（review #3）
      failures.push(`${data.year}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failures;
}

export interface CircuitBreakerOptions {
  maxFailedCount?: number;
  maxDropPercent?: number;
  minDropCount?: number;
  maxStaleCount?: number;
  maxStalePercent?: number;
}

export type CircuitBreakerInput = {
  seriesCount: number;
  failedCount: number;
  staleCount?: number;
};

export type CircuitBreakerResult =
  | { tripped: false }
  | { tripped: true; reason: string };

export function checkCircuitBreaker(
  curr: CircuitBreakerInput,
  prev?: YearData,
  opts?: CircuitBreakerOptions,
): CircuitBreakerResult {
  const maxFailed = opts?.maxFailedCount ?? 5;
  const maxDropPct = opts?.maxDropPercent ?? 0.02;
  const minDropCount = opts?.minDropCount ?? 3;

  if (curr.failedCount > maxFailed) {
    return {
      tripped: true,
      reason: `failed series count (${curr.failedCount}) exceeded limit (${maxFailed})`,
    };
  }
  // Check stale series threshold (detects when Cloudflare blocks or crawler is throttled)
  if (curr.staleCount !== undefined && curr.staleCount > 0) {
    const maxStale = opts?.maxStaleCount ?? (opts?.maxStalePercent ? Math.floor(curr.seriesCount * opts.maxStalePercent) : Math.max(10, Math.floor(curr.seriesCount * 0.2)));
    if (curr.staleCount > maxStale) {
      return {
        tripped: true,
        reason: `stale series count (${curr.staleCount}) exceeded limit (${maxStale}), scraper may be blocked`,
      };
    }
  }


  if (prev && prev.series.length > 0 && curr.seriesCount < prev.series.length) {
    const dropped = prev.series.length - curr.seriesCount;
    const dropPct = dropped / prev.series.length;
    const dropThreshold = Math.max(minDropCount, Math.floor(prev.series.length * maxDropPct));
    if (dropped >= dropThreshold && dropPct > maxDropPct) {
      return {
        tripped: true,
        reason: `series count dropped from ${prev.series.length} to ${curr.seriesCount} (-${dropped}, ${(dropPct * 100).toFixed(1)}% > ${(maxDropPct * 100).toFixed(1)}%)`,
      };
    }
  }

  return { tripped: false };
}

export type RunScrapeOptions = {
  full?: boolean;
  cachedYearData?: YearData;
  concurrency?: number;
  fetcher?: FetchFn;
  circuitBreaker?: CircuitBreakerOptions;
};

export async function runScrape(
  manifest: Manifest,
  opts: RunScrapeOptions = {},
): Promise<YearData> {
  const isFull = opts.full ?? false;
  const concurrency = opts.concurrency ?? 2;
  const fetcher = opts.fetcher ?? fetchHtml;
  const cachedMap = new Map<number, Series>();
  if (opts.cachedYearData?.series) {
    for (const s of opts.cachedYearData.series) cachedMap.set(s.id, s);
  }

  // 1. fetch all pages of signup list
  const cards: SignupCard[] = [];
  let page = 1;
  for (;;) {
    const url = `${manifest.signupListUrl}${page === 1 ? "" : `?page=${page}`}`;
    const html = await fetcher(url);
    const parsed = parseSignupList(html);
    if (parsed.length === 0) break;
    cards.push(...parsed);
    if (!/rel="next"/.test(html)) break;
    page++;
  }

  // 2. per series worker pool
  const scrapeLog: string[] = [];
  let consecutive403 = 0;
  let aborted = false;
  const maxConsecutive403 = 5;

  const results = await pMap(
    cards,
    async (card) => {
      if (aborted) {
        throw new Error("Scrape aborted due to Cloudflare blocks");
      }
      const cached = cachedMap.get(card.seriesId);
      const res = isFull
        ? await scrapeSeriesFull(card, cached, fetcher)
        : await scrapeSeriesIncremental(card, cached, fetcher);

      const is403 =
        (res.status === "stale" && res.error?.includes("403")) ||
        (res.status === "failed" && res.error?.includes("403"));

      if (is403) {
        consecutive403++;
        if (consecutive403 >= maxConsecutive403) {
          aborted = true;
          throw new Error(
            `Cloudflare challenge / HTTP 403 detected across ${consecutive403} consecutive series; aborting scrape to avoid hammering iThome`,
          );
        }
      } else if (res.status === "fresh") {
        consecutive403 = 0;
      }

      return res;
    },
    { concurrency },
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
  const staleCount = scrapeLog.filter((l) => l.startsWith("[stale]")).length;
  const failedCount = scrapeLog.filter((l) => l.startsWith("[failed]")).length;
  const cb = checkCircuitBreaker(
    { seriesCount: series.length, failedCount, staleCount },
    opts.cachedYearData,
    opts.circuitBreaker,
  );
  if (cb.tripped) {
    throw new Error(`circuit breaker tripped: ${cb.reason}`);
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

// CLI pure helpers (injectable run for tests; no network).
export type ScrapeOutcome = { ok: true; data: YearData } | { ok: false; reason: string };
export async function collectYears(
  manifests: Manifest[],
  run: (m: Manifest) => Promise<YearData>,
): Promise<{ succeeded: YearData[]; failures: string[] }> {
  const succeeded: YearData[] = [];
  const failures: string[] = [];
  for (const m of manifests) {
    try {
      const data = await run(m);
      if (data.series.length === 0) {
        failures.push(`${m.year}: 0 series`);
        continue;
      }
      succeeded.push(data);
    } catch (e) {
      failures.push(`${m.year}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { succeeded, failures };
}

export function buildMeta(succeeded: YearData[]): MetaJson {
  const sorted = [...succeeded].sort((a, b) => b.year - a.year);
  const latest = sorted[0];
  return {
    latestYear: latest.year,
    years: sorted.map((d) => d.year),
    updatedAt: latest.updatedAt,
    seriesCount: latest.series.length,
  };
}

// Two-phase atomic write: stage every file to a `.tmp` sibling in the SAME
// directory first (so a staging failure leaves zero renamed files and the
// previous data/meta.json stay intact), then commit via commitWrites —
// rename() is atomic per-file on POSIX, and the recoverable commit protocol
// backs up finals and rolls back on mid-commit failure.
// Returns the staged file list for commitWrites (meta.json staged last).
export type StagedFile = { tmpPath: string; finalPath: string };
export async function stageWrites(
  dataDir: string,
  years: YearData[],
  meta: MetaJson,
): Promise<StagedFile[]> {
  const staged: StagedFile[] = [];
  for (const data of years) {
    const finalPath = join(dataDir, `${data.year}.json`);
    const tmpPath = `${finalPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2));
    staged.push({ tmpPath, finalPath });
  }
  const metaPath = join(dataDir, "meta.json");
  await writeFile(`${metaPath}.tmp`, JSON.stringify(meta, null, 2));
  staged.push({ tmpPath: `${metaPath}.tmp`, finalPath: metaPath });
  return staged;
}

export async function commitWrites(staged: StagedFile[]): Promise<void> {
  // Recoverable commit: back up existing finals, rename staged files into
  // place, and on ANY failure restore the already-replaced finals from backup.
  // (POSIX rename is atomic per file, not across files — this closes the
  // mid-commit window so a failure never leaves a mixed year/meta set.)
  const backups: { bakPath: string; finalPath: string }[] = [];
  const done: StagedFile[] = [];
  try {
    for (const { tmpPath, finalPath } of staged) {
      // Copy (not rename) the existing final aside as backup — the final stays
      // in place until its staged replacement is renamed over it. A final that
      // does not exist yet (e.g. a brand-new year) gets no backup; rollback
      // then removes the renamed-in file to restore the absent pre-commit state.
      try {
        await copyFile(finalPath, `${finalPath}.bak`);
        backups.push({ bakPath: `${finalPath}.bak`, finalPath });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await rename(tmpPath, finalPath);
      done.push({ tmpPath, finalPath });
    }
  } catch (e) {
    // Rollback: restore every final we already replaced — from its backup when
    // a previous file existed, otherwise remove the renamed-in file.
    for (const { finalPath } of done) {
      try {
        const backup = backups.find((b) => b.finalPath === finalPath);
        if (backup) await rename(backup.bakPath, backup.finalPath);
        else await rm(finalPath, { force: true });
      } catch { /* best-effort */ }
    }
    throw e;
  } finally {
    // Cleanup: remove backups and any leftover staged .tmp files.
    for (const { bakPath } of backups) {
      try { await rm(bakPath, { force: true }); } catch { /* best-effort */ }
    }
    for (const { tmpPath } of staged) {
      try { await rm(tmpPath, { force: true }); } catch { /* best-effort */ }
    }
  }
}

// CLI entry
if (import.meta.main) {
  const isFull = process.argv.includes("--full");
  const manifestPath = join(import.meta.dir, "..", "config", "series-manifest.json");
  const manifests: Manifest[] = JSON.parse(await readFile(manifestPath, "utf-8"));
  if (!Array.isArray(manifests) || manifests.length === 0) {
    console.error(`manifest must be a non-empty array: ${manifestPath}`);
    process.exit(1);
  }

  // Duplicate years in the manifest would double-write the same {year}.json
  // (second overwrites the first) and could inject duplicates into meta.years.
  if (new Set(manifests.map((m) => m.year)).size !== manifests.length) {
    console.error("manifest contains duplicate years — aborting; fix config/series-manifest.json");
    process.exit(1);
  }

  const dataDir = join(import.meta.dir, "..", "data");
  await mkdir(dataDir, { recursive: true });

  const { succeeded, failures } = await collectYears(manifests, async (m) => {
    let cachedYearData: YearData | undefined;
    try {
      const raw = await readFile(join(dataDir, `${m.year}.json`), "utf-8");
      cachedYearData = JSON.parse(raw);
    } catch { /* cold start */ }
    return runScrape(m, { full: isFull, cachedYearData });
  });
  // Report per-year failures regardless of outcome (partial scrape visibility).
  for (const f of failures) console.error(`[${f}]`);
  if (succeeded.length === 0) {
    // All-failed: abort without writing anything (previous data/meta stay untouched).
    console.error("all years failed — aborting writes, keeping previous data");
    process.exit(1);
  }

  // History snapshots: independent of the atomic main-file commit (spec §5.2).
  // Per-year failures are collected and logged; they never block the main
  // {year}.json write (review #3).
  //
  // Written on EVERY run, deliberately. It looks wasteful — the file is keyed by
  // Taipei date, so the 15-minute scraper rewrites and re-commits the same ~1.9MB
  // file ~96 times a day — but it costs git essentially nothing: this snapshot is
  // byte-identical to the data/{year}.json written by stageWrites below (same
  // object, same JSON.stringify(data, null, 2)), so git content-addressing stores
  // one shared blob per run, not two. Measured on the real repo: data/history/
  // accounts for 1.26 MiB of a 36.5 MiB pack, against 30.37 MiB for
  // data/<year>.json itself.
  //
  // Do not "optimise" this to once a day. That trades zero storage for a real
  // failure mode: one write per day means one chance per day, and the obvious
  // place to hang it — a GitHub `schedule` cron — is the exact trigger this
  // project abandoned as unreliable (see .github/workflows/scheduled-update.yml).
  // Writing every run means any successful scrape leaves the day's snapshot, and
  // the last run of the day naturally wins.
  try {
    const failures = await writeHistorySnapshots(dataDir, succeeded);
    for (const f of failures) console.error(`history snapshot failed: ${f}`);
  } catch (e) {
    // writeHistorySnapshots 本身不 throw（單年度失敗已內收），此 catch 為防護
    console.error(`history snapshot error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const meta = buildMeta(succeeded);
  // Two-phase commit: stage all files to `.tmp` siblings in the same directory,
  // then rename them into place. A staging failure exits before any rename —
  // previous data/meta stay intact. Rename is atomic per file on POSIX, and
  // commitWrites backs up finals and rolls back already-replaced files on any
  // mid-commit failure, so a failure never leaves a mixed year/meta set.
  let staged: StagedFile[];
  try {
    staged = await stageWrites(dataDir, succeeded, meta);
  } catch (e) {
    console.error(`write failed: ${e instanceof Error ? e.message : String(e)} — keeping previous data`);
    process.exit(1);
  }
  try {
    await commitWrites(staged);
  } catch (e) {
    console.error(`commit failed: ${e instanceof Error ? e.message : String(e)} — keeping previous data`);
    process.exit(1);
  }
  console.log(`wrote ${succeeded.length} year file(s); latest ${meta.latestYear} with ${meta.seriesCount} series`);
}
