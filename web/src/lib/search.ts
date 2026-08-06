import type { Series } from "../../../scripts/types"; // 與 Dashboard.astro 同路徑慣例

// web/src/lib/search.ts — 純函數、無 DOM、無 window、無 runtime 依賴。

// 全形 ASCII 對應區段（U+FF01–U+FF5E）收斂成半形；U+FF5E（～）→ ~。
// 注意：全形中文標點（如「，」U+FF0C）也在 U+FF01–U+FF5E 區段內，會被收斂成半形 `,`。
function fullToHalf(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

export function normalize(s: string): string {
  return fullToHalf(s.normalize("NFC").toLowerCase()).replace(/\s/g, "");
}

// 每個 token 在任一欄位命中即算該 token 命中；所有 token 都命中才列入候選（AND）。
function tokenHits(series: Series, token: string): boolean {
  return (
    normalize(series.title).includes(token) ||
    normalize(series.user.name).includes(token) ||
    normalize(series.group).includes(token) ||
    (series.team !== null && normalize(series.team).includes(token))
  );
}

export function seriesMatchesQuery(series: Series, query: string): boolean {
  const tokens = query.split(/\s+/).map(normalize).filter(Boolean);
  if (tokens.length === 0) return true; // 空 query / 全空白 → 搜尋關閉
  return tokens.every((t) => tokenHits(series, t));
}
