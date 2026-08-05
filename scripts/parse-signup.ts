// scripts/parse-signup.ts
import type { SignupCard } from "./types";

export function signupListUrl(year: number): string {
  return `https://ithelp.ithome.com.tw/${year}ironman/signup/list`;
}

export function parseSignupList(html: string): SignupCard[] {
  const cards: SignupCard[] = [];
  for (const block of html.split('<div class="list-card">').slice(1)) {
    const m = block.match(/\/users\/(\d+)\/ironman\/(\d+)/);
    if (!m) continue;
    const userId = Number(m[1]);
    const seriesId = Number(m[2]);
    const name = block.match(/contestants-list__name">([^<]+)/)?.[1]?.trim() ?? "";
    const group = block.match(/<div class="tag">[\s\S]*?<span>([^<]+)<\/span>/)?.[1]?.trim() ?? "";
    const title = block.match(/contestants-list__title title">([^<]+)/)?.[1]?.trim() ?? "";
    const description = block.match(/contestants-list__desc content">([\s\S]*?)<\/p>/)?.[1]?.trim() ?? "";
    const team = block.match(/team-badge">所屬團隊<\/span>\s*<a[^>]*>([^<]+)<\/a>/)?.[1]?.trim() ?? null;
    const signupDate = block.match(/報名日期：([\d/]+ [\d:]+)/)?.[1] ?? "";
    const day = block.match(/DAY\s*(\d+)/) ? Number(block.match(/DAY\s*(\d+)/)![1]) : 0;
    cards.push({ seriesId, userId, name, group, title, description, team, signupDate, day });
  }
  return cards;
}
