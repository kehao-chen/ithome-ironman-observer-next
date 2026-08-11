// web/src/lib/filter.ts — Dashboard 資料層（純函式）。
// 管線：fav 子集 → 組別 filter → 搜尋 filter → 排序。
// 搜尋必須在組別之後、排序之前（spec: 2026-08-06-ironman-observer-search-design.md §3.1）。
// 無 DOM、無 window、無 runtime 依賴（僅 daily-status / search / card 的純函式）——可單元測試。
// 這是全專案最後一塊原本沒有測試覆蓋的商業邏輯（排序語意跨 search/daily-status/favorites 三個 spec）。
import { taipeiDay } from "./daily-status";
import { totalViewsOf, type ViewSeries } from "./card";
import { seriesMatchesQuery } from "./search";
import type { YearData } from "../../../scripts/types";

export type SortKey = "dayCount" | "views" | "latest" | "todayViews";

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
// team: 前綴（計分板「看該隊系列」chip）——需要 teamNames 參數檢查該隊是否仍在；不傳（既有呼叫）→ 語意不變（team: 視為不存在 → 全部）。
export function activeGroupFor(groups: string[], requested: string, teamNames?: string[]): string {
  if (requested === "fav") return "fav";
  if (requested.startsWith("team:")) {
    const t = requested.slice(5);
    return teamNames?.includes(t) ? requested : "全部";
  }
  return groups.includes(requested) ? requested : "全部";
}

// 最新文章 pub 時間 ms（無文章 = 0，讓空系列在「今日發文」排序沉底）。
// 缺陷日期 → 0（與無文章同級）：避免 NaN 進 comparator 破壞 sort 穩定度。
function latestPubMs(s: ViewSeries): number {
  if (!s.articles.length) return 0;
  const ms = new Date(s.articles[s.articles.length - 1].publishedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// 「當篇觀看（今日）」排序鍵：該系列今日（排序錨點日）文章的最大觀看數。
// 語意：-1 = 無今日文章（沉底）；≥0 = 今日有文章，值為今日最大觀看（今日文章 0 觀看 = 0，
// 仍是「今日有發文」，排在任何無今日文章系列之前）。
// compact 資料帶 todayMaxViews（frontmatter 由完整 articles 預計算，同樣 -1 語意）；
// 完整資料由 articles 即時推導：今日最大觀看 = max over 臺北日 == anchorDay 的 views。
// anchorDay 為資料快照日（data.updatedAt 的臺北日）——與「今日發文」chip 的 runtime
// 判定不同：排序錨點隨快照走，跨日不漂移（60s refresh 取得新快照即更新錨點）。
export function todayMaxViewsOf(s: ViewSeries, anchorDay: string): number {
  if (typeof s.todayMaxViews === "number") return s.todayMaxViews;
  let max = -1;
  for (const a of s.articles) {
    if (taipeiDay(a.publishedAt) === anchorDay && a.views > max) max = a.views;
  }
  return max;
}

// 尚未開賽（無文章）系列的報名日 ms；無效/空 → 0（排序時沉底到最後）。
function signupMs(s: ViewSeries): number {
  const d = s.signupDate.slice(0, 10);
  if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(d)) return 0;
  const ms = Date.parse(`${d.replace(/\//g, "-")}T00:00:00Z`); // Date.parse 不吃斜線 YYYY/MM/DD
  return Number.isFinite(ms) ? ms : 0;
}

// 依 sort 語意排序（[...series] 副本，不 mutate 輸入）。
// anchorDay：「當篇觀看（今日）」的今日錨點（臺北日）；預設 = 資料快照日。
function sortSeries(series: ViewSeries[], sort: SortKey, anchorDay: string): ViewSeries[] {
  return [...series].sort((a, b) => {
    if (sort === "views") return totalViewsOf(b) - totalViewsOf(a);
    if (sort === "todayViews") {
      const va = todayMaxViewsOf(a, anchorDay), vb = todayMaxViewsOf(b, anchorDay);
      // -1 哨兵：任何今日文章（≥0）恆在無今日文章（-1）之前；有今日者依最大觀看 desc。
      if (va !== vb) return vb - va;
      // 平手且皆無今日文章 → 依進度 desc（與「今日發文」排序的沉底段語意一致）。
      if (va === -1) return b.dayCount - a.dayCount;
      return 0; // 兩者皆有今日文章且觀看相同 → 穩定序（來源序）
    }
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
  } else if (opts.group.startsWith("team:")) {
    // 團隊系列流：該隊成員子集（必須在 group 相等比對之前，否則 team: 前綴永不命中）
    const t = opts.group.slice(5);
    series = series.filter((s) => s.team === t);
  } else if (opts.group !== "全部") {
    series = series.filter((s) => s.group === opts.group);
  }
  series = series.filter((s) => seriesMatchesQuery(s, opts.query)); // 搜尋：組別之後、排序之前（spec §3.1）
  // 排序錨點日：「當篇觀看（今日）」的今日 = 資料快照日（updatedAt 的臺北日），跨日不漂移。
  const anchorDay = taipeiDay(data.updatedAt);
  return sortSeries(series, opts.sort, anchorDay);
}
