// web/src/lib/filter.ts — Dashboard 資料層（純函式）。
// 管線：fav 子集 → 組別 filter → 搜尋 filter → 排序。
// 搜尋必須在組別之後、排序之前（spec: 2026-08-06-ironman-observer-search-design.md §3.1）。
// 無 DOM、無 window、無 runtime 依賴（僅 daily-status / search / card 的純函式）——可單元測試。
// 這是全專案最後一塊原本沒有測試覆蓋的商業邏輯（排序語意跨 search/daily-status/favorites 三個 spec）。
import { taipeiDay } from "./daily-status";
import { totalViewsOf, type ViewSeries } from "./card";
import { seriesMatchesQuery } from "./search";
import type { YearData } from "../../../scripts/types";

export type SortKey = "dayCount" | "views" | "latest";

export type SeriesFilterOptions = {
  group: string; // "全部" | 組別名 | "fav"
  sort: SortKey;
  query: string;
  favSet: ReadonlySet<number>;
};

// 目前年度資料中已收藏且存在的系列（收藏分頁的資料子集）。
export function favSeries(data: YearData, favSet: ReadonlySet<number>): ViewSeries[] {
  return data.series.filter((s) => favSet.has(s.id));
}

// 收藏分頁的 shown/total 分母：目前年度可顯示收藏數。
export function currentYearFavCount(data: YearData, favSet: ReadonlySet<number>): number {
  return favSeries(data, favSet).length;
}

// 組別計數（含「全部」= series.length，與 SSR countFor 語意一致）。
export function groupCounts(data: YearData): Map<string, number> {
  const m = new Map<string, number>();
  m.set("全部", data.series.length);
  for (const s of data.series) m.set(s.group, (m.get(s.group) ?? 0) + 1);
  return m;
}

// 年度切換時 resolve active：fav 恆保留；普通組別在新年度不存在 → fallback「全部」。
export function activeGroupFor(groups: string[], requested: string): string {
  if (requested === "fav") return "fav";
  return groups.includes(requested) ? requested : "全部";
}

// 最新文章 pub 時間 ms（無文章 = 0，讓空系列在「今日發文」排序沉底）。
// 缺陷日期 → 0（與無文章同級）：避免 NaN 進 comparator 破壞 sort 穩定度。
function latestPubMs(s: ViewSeries): number {
  if (!s.articles.length) return 0;
  const ms = new Date(s.articles[s.articles.length - 1].publishedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// 尚未開賽（無文章）系列的報名日 ms；無效/空 → 0（排序時沉底到最後）。
function signupMs(s: ViewSeries): number {
  const d = s.signupDate.slice(0, 10);
  if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(d)) return 0;
  const ms = Date.parse(`${d.replace(/\//g, "-")}T00:00:00Z`); // Date.parse 不吃斜線 YYYY/MM/DD
  return Number.isFinite(ms) ? ms : 0;
}

// 依 sort 語意排序（[...series] 副本，不 mutate 輸入）。
function sortSeries(series: ViewSeries[], sort: SortKey): ViewSeries[] {
  return [...series].sort((a, b) => {
    if (sort === "views") return totalViewsOf(b) - totalViewsOf(a);
    if (sort === "latest") {
      const lastA = a.articles.length ? a.articles[a.articles.length - 1] : null;
      const lastB = b.articles.length ? b.articles[b.articles.length - 1] : null;
      const da = taipeiDay(lastA?.publishedAt), db = taipeiDay(lastB?.publishedAt);
      if (!da && !db) {
        // 兩者皆無文章：dayCount > 0（停更/刪文）依進度 desc；
        // dayCount 0（尚未開賽）依報名日近者在前（早報名優先）——讓「等開賽」的排在最後、報名最新者沉底。
        if (a.dayCount > 0 || b.dayCount > 0) return b.dayCount - a.dayCount;
        return signupMs(a) - signupMs(b);
      }
      if (!da) return 1;   // a 無文章 → 沉底
      if (!db) return -1;  // b 無文章 → 沉底
      const byDay = db.localeCompare(da); // 臺北日 desc
      if (byDay !== 0) return byDay;
      return latestPubMs(b) - latestPubMs(a); // 同日內按發文秒 desc
    }
    return b.dayCount - a.dayCount;
  });
}

// 完整資料層 pipeline。回傳新陣列，data.series 不被 mutate。
export function applySeriesFilters(data: YearData, opts: SeriesFilterOptions): ViewSeries[] {
  let series: ViewSeries[] = data.series;
  if (opts.group === "fav") {
    series = favSeries(data, opts.favSet); // 收藏分頁：目前年度已收藏子集
  } else if (opts.group !== "全部") {
    series = series.filter((s) => s.group === opts.group);
  }
  series = series.filter((s) => seriesMatchesQuery(s, opts.query)); // 搜尋：組別之後、排序之前（spec §3.1）
  return sortSeries(series, opts.sort);
}
