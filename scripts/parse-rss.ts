// scripts/parse-rss.ts
import type { RssChannel } from "./types";

export function rssUrl(seriesId: number): string {
  return `https://ithelp.ithome.com.tw/rss/series/${seriesId}`;
}

function parseRfc822(s: string): string | null {
  // "Wed, 05 Aug 2026 09:37:43 +0800" -> "2026-08-05T09:37:43+08:00"
  // Renders the wall clock at the source offset: UTC instant = wall clock - offset,
  // so the emitted label matches the time a consumer in that zone actually sees.
  try {
    const offsetMatch = s.match(/([+-])(\d{2})(\d{2})$/);
    const d = new Date(s);
    if (!offsetMatch || Number.isNaN(d.getTime())) return null;
    const sign = offsetMatch[1] === "-" ? -1 : 1;
    const offsetMin = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
    const shifted = new Date(d.getTime() + offsetMin * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const wallClock =
      `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
      `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
    return `${wallClock}${offsetMatch[1]}${offsetMatch[2]}:${offsetMatch[3]}`;
  } catch {
    return null;
  }
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
