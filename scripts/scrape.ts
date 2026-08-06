// scripts/scrape.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHtml } from "./fetch-html";
import { parseSignupList, signupListUrl } from "./parse-signup";
import { parseRss, rssUrl } from "./parse-rss";
import { parseSeriesPage, seriesUrl } from "./parse-series";
import type { Manifest, Series, SignupCard, YearData, SeriesStats, RssChannel, MetaJson } from "./types";

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

// Emit the real Taipei wall clock (UTC+8, no DST) as ISO +08:00.
// Naive `new Date().toISOString().replace("Z","+08:00")` relabels UTC digits
// as +08:00 without shifting — 8h stale. Shift first, then stamp.
export function taipeiTimestamp(d: Date): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ") + "+08:00";
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

  // 2. per series: RSS + series page (2 requests each)
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
      statsBySeries.set(card.seriesId, parseSeriesPage(pageHtml));
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

// CLI entry
if (import.meta.main) {
  const manifestPath = join(import.meta.dir, "..", "config", "series-manifest.json");
  const manifests: Manifest[] = JSON.parse(await readFile(manifestPath, "utf-8"));
  if (!Array.isArray(manifests) || manifests.length === 0) {
    console.error(`manifest must be a non-empty array: ${manifestPath}`);
    process.exit(1);
  }

  const dataDir = join(import.meta.dir, "..", "data");
  await mkdir(dataDir, { recursive: true });

  // Per-year isolation: runScrape rejection or empty result = year failure.
  // Keep writing until all years are attempted; decide writes atomically after.
  const succeeded: YearData[] = [];
  for (const m of manifests) {
    try {
      const data = await runScrape(m);
      if (data.series.length === 0) {
        console.error(`[${m.year}] scrape produced 0 series — keeping previous data, skipping write`);
        continue;
      }
      succeeded.push(data);
      console.log(`[${m.year}] scraped ${data.series.length} series`);
    } catch (e) {
      console.error(`[${m.year}] scrape failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (succeeded.length === 0) {
    // Atomic: nothing written, keep previous data/meta untouched.
    console.error("all years failed — aborting writes, keeping previous data");
    process.exit(1);
  }

  succeeded.sort((a, b) => b.year - a.year); // desc
  const latest = succeeded[0];
  for (const data of succeeded) {
    await writeFile(join(dataDir, `${data.year}.json`), JSON.stringify(data, null, 2));
  }
  const meta: MetaJson = {
    latestYear: latest.year,
    years: succeeded.map((d) => d.year),
    updatedAt: latest.updatedAt,
    seriesCount: latest.series.length,
  };
  await writeFile(join(dataDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`wrote ${succeeded.length} year file(s); latest ${latest.year} with ${latest.series.length} series`);
}
