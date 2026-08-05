// scripts/parse-rss.ts
import type { RssChannel } from "./types";

export function rssUrl(seriesId: number): string {
  return `https://ithelp.ithome.com.tw/rss/series/${seriesId}`;
}

function parseRfc822(s: string): string {
  // "Wed, 05 Aug 2026 09:39:41 +0800" -> ISO +08:00
  const d = new Date(s);
  const iso = d.toISOString();
  return iso.replace("Z", "+08:00");
}

export function parseRss(xml: string): RssChannel {
  const ch = xml.match(/<channel>([\s\S]*?)<\/channel>/)?.[1] ?? "";
  const title = ch.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
  const link = ch.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
  const description = ch.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? "";
  const lastBuild = ch.match(/<lastBuildDate>([\s\S]*?)<\/lastBuildDate>/)?.[1];
  const items = [...ch.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((mm) => ({
    title: mm[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "",
    link: mm[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "",
    pubDate: mm[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "",
    description: mm[1].match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? "",
  }));
  return {
    title,
    link,
    description,
    lastBuildDate: lastBuild ? parseRfc822(lastBuild) : null,
    items,
  };
}
