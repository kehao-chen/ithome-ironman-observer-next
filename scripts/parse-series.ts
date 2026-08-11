// scripts/parse-series.ts
import type { SeriesStats } from "./types";
import { decodeHtmlEntities } from "./html-entities";

export function seriesUrl(userId: number, seriesId: number): string {
  return `https://ithelp.ithome.com.tw/users/${userId}/ironman/${seriesId}`;
}

// 系列頁文章清單會分頁（每頁 10 篇，第 2 頁起 ?page=N）。每頁的「參賽天數／共 N 篇
// 文章」頭部都重複出現，所以 dayCount/articleCount/subscriptions 只在第 1 頁取。
export type SeriesPage = SeriesStats & {
  articles: SeriesStats["articles"];
  // 有下一頁時為「相對下一頁網址」（?page=2 / ?page=3…，無 query 時回傳 ?page=2）；
  // 沒有下一頁（最後一頁或無分頁）為 null。
  nextPage: string | null;
};

// 從一頁 HTML 抽出文章區塊。兩層結構（真實頁面）：分頁時每個 block 都包一層
// <div class="qa-list profile-list ir-profile-list">，fixture（無分頁）只有最外層
// 一個 wrapper；split 後以 block 開頭為準，首個空白 chunk 即 wrapper 殘骸，直接跳過。
function extractArticleChunks(html: string): string[] {
  const chunks = html.split('<div class="profile-list__condition">');
  return chunks.slice(1).filter((c) => /articles\/\d+/.test(c));
}

// DAY n 徽章（`ir-qa-list__days` span）是官方數字；fixture 沒有徽章，fallback 標題
// 「Day N」。分頁時整個 block 都包在 `qa-list profile-list` 巢狀 wrapper 裡，
// 不能用全頁 regex（會跨 block 誤配）——只在單一 block chunk 內找。
export function parseSeriesPage(html: string): SeriesPage {
  const dayCount = Number(html.match(/參賽天數\s*(\d+)\s*天/)?.[1] ?? 0);
  const articleCount = Number(html.match(/共\s*(\d+)\s*篇文章/)?.[1] ?? 0);
  const subscriptions = Number(html.match(/<span class="subscription-amount">(\d+)<\/span>\s*人訂閱/)?.[1] ?? 0);

  const articles: SeriesStats["articles"] = [];
  for (const b of extractArticleChunks(html)) {
    const id = Number(b.match(/articles\/(\d+)/)?.[1] ?? 0);
    if (!id) continue;
    const title = decodeHtmlEntities(
      b.match(/qa-list__title-link[^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1]
        ?.replace(/<[^>]+>/g, "").trim() ?? "",
    );
    const publishedAt = b.match(/title="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"/)?.[1] ?? "";
    const stats = [...b.matchAll(/qa-condition__count">(\d+)<\/span>\s*<span class="qa-condition__text">(Like|留言|瀏覽)/g)];
    const views = Number(stats.find((x) => x[2] === "瀏覽")?.[1] ?? 0);
    const likes = Number(stats.find((x) => x[2] === "Like")?.[1] ?? 0);
    const comments = Number(stats.find((x) => x[2] === "留言")?.[1] ?? 0);
    const day = Number(b.match(/ir-qa-list__days[^>]*>\s*DAY\s*(\d+)/)?.[1]
      ?? Number(b.match(/DAY\s*(\d+)/)?.[1]
        ?? Number(title.match(/Day (\d+)/)?.[1] ?? 0)));
    articles.push({
      id, day, title, url: `https://ithelp.ithome.com.tw/articles/${id}`,
      publishedAt: publishedAt.replace(" ", "T") + "+08:00",
      views, likes, comments,
    });
  }

  // 下一頁判定：profile-pagination 區塊內含 rel="next" 的錨點（href 在 rel 前後皆可）。
  // 相對網址（?page=2）回傳原樣，絕對網址轉成相對 query（?page=N），
  // 避免第二頁以後帶絕對 base。
  let nextPage: string | null = null;
  const pagination = html.match(/<div class="profile-pagination">[\s\S]*?<\/div>/)?.[0] ?? "";
  const anchor = pagination.match(/<a[^>]*rel="next"[^>]*>/)?.[0];
  const href = anchor?.match(/href="([^"]+)"/)?.[1];
  if (href) {
    const abs = href.match(/[?&]page=(\d+)/)?.[1];
    nextPage = abs ? `?page=${abs}` : href;
  }
  return { dayCount, articleCount, subscriptions, articles, nextPage };
}
