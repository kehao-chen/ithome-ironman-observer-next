// scripts/scrape.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHtml } from "./fetch-html";
import { parseSignupList, signupListUrl } from "./parse-signup";
import { parseRss, rssUrl } from "./parse-rss";
import { parseSeriesPage, seriesUrl } from "./parse-series";
import type { Manifest, Series, SignupCard, YearData, SeriesStats, RssChannel } from "./types";

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
    updatedAt: new Date().toISOString().replace("Z", "+08:00"),
    groups,
    series,
    // @ts-expect-error scrapeLog is runtime-only diagnostics
    scrapeLog: errors,
  };
}

// CLI entry
if (import.meta.main) {
  const manifestPath = join(import.meta.dir, "..", "config", "series-manifest.json");
  const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const data = await runScrape(manifest);

  const dataDir = join(import.meta.dir, "..", "data");
  await mkdir(dataDir, { recursive: true });

  // empty-guard: if nothing parsed, keep previous data
  if (data.series.length === 0) {
    console.error("scrape produced 0 series — aborting write, keeping previous data");
    process.exit(1);
  }

  await writeFile(join(dataDir, `${manifest.year}.json`), JSON.stringify(data, null, 2));
  await writeFile(
    join(dataDir, "meta.json"),
    JSON.stringify({ updatedAt: data.updatedAt, seriesCount: data.series.length }, null, 2),
  );
  console.log(`wrote data/${manifest.year}.json with ${data.series.length} series`);
}
