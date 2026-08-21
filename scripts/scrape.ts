// scripts/scrape.ts
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHtml } from "./fetch-html";
import { parseSignupList, signupListUrl } from "./parse-signup";
import { parseRss, rssUrl } from "./parse-rss";
import { parseSeriesPage, seriesUrl, isArticlePage } from "./parse-series";
import { parseArticleDay } from "./parse-article";
import type { Manifest, Series, SignupCard, YearData, SeriesStats, RssChannel, MetaJson, OfficialDayCountResult } from "./types";

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
      signupDate: c.signupDate.replace(" ", "T") + "+08:00",
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

// Emit the real Taipei wall clock (UTC+8, no DST) as ISO +08:00.
// Naive `new Date().toISOString().replace("Z","+08:00")` relabels UTC digits
// as +08:00 without shifting — 8h stale. Shift first, then stamp.
export function taipeiTimestamp(d: Date): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ") + "+08:00";
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

export async function runScrape(manifest: Manifest): Promise<YearData> {
  // 1. fetch all pages of signup list
  const cards: SignupCard[] = [];
  let page = 1;
  for (;;) {
    const url = `${manifest.signupListUrl}${page === 1 ? "" : `?page=${page}`}`;
    const html = await fetchHtml(url);
    const parsed = parseSignupList(html);
    if (parsed.length === 0) break;
    cards.push(...parsed);
    const hasNext = /rel="next"/.test(html);
    if (!hasNext) break;
    page++;
  }

  // 2. per series: RSS + series page (2 requests each; series 頁分頁時逐頁抓取)
  const statsBySeries = new Map<number, SeriesStats>();
  const rssBySeries = new Map<number, RssChannel>();
  const errors: string[] = [];
  for (const card of cards) {
    try {
      const [rssXml, pageHtml] = await Promise.all([
        fetchHtml(rssUrl(card.seriesId)),
        fetchHtml(seriesUrl(card.userId, card.seriesId)),
      ]);
      rssBySeries.set(card.seriesId, parseRss(rssXml));
      // series 頁文章清單分頁：每頁約 10 篇，30 天系列最多 3 頁。
      // 逐頁串接 articles；dayCount/articleCount/subscriptions 只在第 1 頁取。
      const first = parseSeriesPage(pageHtml);
      const articles = [...first.articles];
      let page: string | null = first.nextPage;
      while (page) {
        const more = parseSeriesPage(await fetchHtml(seriesUrl(card.userId, card.seriesId) + page));
        articles.push(...more.articles);
        page = more.nextPage;
      }
      // dayCount = 官方參賽天數（2026-08-19 修正，語意見 officialDayCount）。
      // 舊規則 max(標頭, 去重標題 Day) 已移除：標題是作者自填、會超前 streak，
      // 把「12 天內補滿 30 篇」誤判成完賽（2026-08-18 的「標頭凍結」是誤診，
      // 標頭 12 本來就是官方值）。
      const dayRes = await officialDayCount(first.dayCount, articles[articles.length - 1]?.url);
      if (dayRes.warning) errors.push(`${card.seriesId}: ${dayRes.warning}`);
      statsBySeries.set(card.seriesId, {
        dayCount: dayRes.dayCount,
        articleCount: first.articleCount,
        subscriptions: first.subscriptions,
        articles,
      });
    } catch (e) {
      errors.push(`${card.seriesId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 150)); // be gentle to ithelp
  }

  const series = mergeCardsAndStats(cards, statsBySeries, rssBySeries);
  const groups = [...new Set(series.map((s) => s.group))].sort();
  return {
    year: manifest.year,
    updatedAt: taipeiTimestamp(new Date()),
    groups,
    series,
    scrapeLog: errors,
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

  const { succeeded, failures } = await collectYears(manifests, runScrape);

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
