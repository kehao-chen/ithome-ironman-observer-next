// scripts/parse-series.ts
import type { SeriesStats } from "./types";

export function seriesUrl(userId: number, seriesId: number): string {
  return `https://ithelp.ithome.com.tw/users/${userId}/ironman/${seriesId}`;
}

export function parseSeriesPage(html: string): SeriesStats {
  const dayCount = Number(html.match(/參賽天數\s*(\d+)\s*天/)?.[1] ?? 0);
  const articleCount = Number(html.match(/共\s*(\d+)\s*篇文章/)?.[1] ?? 0);
  const subscriptions = Number(html.match(/<span class="subscription-amount">(\d+)<\/span>\s*人訂閱/)?.[1] ?? 0);

  const articles: SeriesStats["articles"] = [];
  const blocks = html.split('<div class="profile-list__condition">').slice(1);
  for (const b of blocks) {
    const id = Number(b.match(/articles\/(\d+)/)?.[1] ?? 0);
    if (!id) continue;
    const title = b.match(/qa-list__title-link[^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1]
      ?.replace(/<[^>]+>/g, "").trim() ?? "";
    const publishedAt = b.match(/title="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"/)?.[1] ?? "";
    const stats = [...b.matchAll(/qa-condition__count">(\d+)<\/span>\s*<span class="qa-condition__text">(Like|留言|瀏覽)/g)];
    const views = Number(stats.find((x) => x[2] === "瀏覽")?.[1] ?? 0);
    const likes = Number(stats.find((x) => x[2] === "Like")?.[1] ?? 0);
    const comments = Number(stats.find((x) => x[2] === "留言")?.[1] ?? 0);
    const day = Number(b.match(/DAY\s*(\d+)/)?.[1] ?? Number(title.match(/Day (\d+)/)?.[1] ?? 0));
    articles.push({
      id, day, title, url: `https://ithelp.ithome.com.tw/articles/${id}`,
      publishedAt: publishedAt.replace(" ", "T") + "+08:00",
      views, likes, comments,
    });
  }
  return { dayCount, articleCount, subscriptions, articles };
}
