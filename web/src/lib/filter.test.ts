// filter.ts 資料層測試：fav 子集 → 組別 → 搜尋 → 排序的語意契約。
// 這是全專案最後一塊原本無測試的商業邏輯（排序語意跨 search/daily-status/favorites 三個 spec）。
import { describe, expect, test } from "bun:test";
import type { Series, YearData } from "../../../scripts/types";
import { applySeriesFilters, activeGroupFor, currentYearFavCount, favSeries, groupCounts } from "./filter";
import { totalViewsOf } from "./card";
import { taipeiDay } from "./daily-status";
import realData from "../../../data/2026.json";

const NO_FAV = new Set<number>();

function makeSeries(partial: Partial<Series> & { sumViews?: number }): Series & { sumViews?: number } {
  const base: Series = {
    id: 9034,
    user: { id: 20118581, name: "SQLMASTER", profileUrl: "https://ithelp.ithome.com.tw/users/20118581" },
    group: "自我挑戰組",
    title: "SQL Server 基礎&調教",
    description: "",
    team: null,
    signupDate: "2026/08/01T12:07:01+08:00",
    lastUpdated: null,
    dayCount: 7,
    articleCount: 7,
    subscriptions: 10,
    articles: [
      { id: 1, day: 1, title: "Day 1", url: "u1", publishedAt: "2026-08-01T12:00:00+08:00", views: 10, likes: 0, comments: 0 },
      { id: 7, day: 7, title: "Day 7", url: "u7", publishedAt: "2026-08-07T13:00:00+08:00", views: 99, likes: 1, comments: 2 },
    ],
  };
  return { ...base, ...partial };
}

function makeData(series: (Series & { sumViews?: number })[]): YearData {
  return {
    year: 2026,
    updatedAt: "2026-08-07T13:23:00+08:00",
    groups: [...new Set(series.map((s) => s.group))],
    series,
    scrapeLog: [],
  };
}

describe("applySeriesFilters — 組別 filter", () => {
  test("全部 → 原樣，預設依進度 desc", () => {
    const a = makeSeries({ id: 1, dayCount: 5, title: "A" });
    const b = makeSeries({ id: 2, dayCount: 10, title: "B" });
    const r = applySeriesFilters(makeData([a, b]), { group: "全部", sort: "dayCount", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([2, 1]);
  });
  test("特定組別 → 只留該組", () => {
    const a = makeSeries({ id: 1, group: "現代" });
    const b = makeSeries({ id: 2, group: "自我挑戰組" });
    const r = applySeriesFilters(makeData([a, b]), { group: "自我挑戰組", sort: "dayCount", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([2]);
  });
  test("fav → 只留已收藏（且存在於目前年度）", () => {
    const a = makeSeries({ id: 1 });
    const b = makeSeries({ id: 2 });
    const r = applySeriesFilters(makeData([a, b]), { group: "fav", sort: "dayCount", query: "", favSet: new Set([1]) });
    expect(r.map((s) => s.id)).toEqual([1]);
  });
});

describe("applySeriesFilters — 排序語意", () => {
  test("dayCount：desc", () => {
    const a = makeSeries({ id: 1, dayCount: 3 });
    const b = makeSeries({ id: 2, dayCount: 30 });
    const c = makeSeries({ id: 3, dayCount: 0 });
    const r = applySeriesFilters(makeData([a, b, c]), { group: "全部", sort: "dayCount", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([2, 1, 3]);
  });

  test("views：totalViewsOf desc（sumViews 優先，無則 articles 求和）", () => {
    const a = makeSeries({ id: 1, sumViews: 50 });
    const b = makeSeries({ id: 2, sumViews: 120 });
    const c = makeSeries({ id: 3 }); // 無 sumViews → articles 求和 = 10 + 99 = 109
    const r = applySeriesFilters(makeData([a, b, c]), { group: "全部", sort: "views", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([2, 3, 1]);
    expect(totalViewsOf(c)).toBe(109);
  });

  test("latest：有文章者在前，臺北日 desc，同日按發文秒 desc，無文章沉底", () => {
    const a = makeSeries({ id: 1, articles: [{ id: 7, day: 7, title: "Day 7", url: "u", publishedAt: "2026-08-07T13:00:00+08:00", views: 1, likes: 0, comments: 0 }] });
    const c = makeSeries({ id: 3, articles: [{ id: 7, day: 7, title: "Day 7早", url: "u", publishedAt: "2026-08-07T09:00:00+08:00", views: 1, likes: 0, comments: 0 }] }); // 同日較早
    const b = makeSeries({ id: 2, articles: [{ id: 6, day: 6, title: "Day 6", url: "u", publishedAt: "2026-08-06T13:00:00+08:00", views: 1, likes: 0, comments: 0 }] }); // 前一天
    const d = makeSeries({ id: 4, dayCount: 3, articles: [] }); // 無文章（但進度較高）
    const r = applySeriesFilters(makeData([a, b, c, d]), { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 3, 2, 4]);
  });

  test("latest：兩者皆無文章 → 依進度 desc", () => {
    const d1 = makeSeries({ id: 1, dayCount: 3, articles: [] });
    const d2 = makeSeries({ id: 2, dayCount: 0, articles: [] });
    const r = applySeriesFilters(makeData([d1, d2]), { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2]);
  });

  test("latest：一無一文時，有文章者恆在無文章者之前（即使進度較低）", () => {
    const hasArticle = makeSeries({ id: 1, dayCount: 1, articles: [{ id: 1, day: 1, title: "D1", url: "u", publishedAt: "2026-08-01T12:00:00+08:00", views: 1, likes: 0, comments: 0 }] });
    const noArticle = makeSeries({ id: 2, dayCount: 29, articles: [] });
    const r = applySeriesFilters(makeData([hasArticle, noArticle]), { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2]);
  });

  test("latest：taipeiDay 格式契約——排序依賴 YYYY-MM-DD 字串層級比較", () => {
    // 排序的「臺北日 desc」靠 taipeiDay 回傳 YYYY-MM-DD 字串（lexicographic == chronological）。
    // 直接釘死這個契約：若 taipeiDay 未來改變格式（例：帶時間），此測試立即紅燈。
    expect(taipeiDay("2026-08-07T23:30:00+08:00")).toBe("2026-08-07");
    expect(taipeiDay(undefined)).toBe("");
    expect(taipeiDay(null)).toBe("");
  });

  test("latest：同日不同秒 → 較晚發文者在前（秒級 desc 契約）", () => {
    const late = makeSeries({ id: 1, articles: [{ id: 1, day: 1, title: "晚", url: "u", publishedAt: "2026-08-07T23:59:59+08:00", views: 1, likes: 0, comments: 0 }] });
    const early = makeSeries({ id: 2, articles: [{ id: 1, day: 1, title: "早", url: "u", publishedAt: "2026-08-07T00:00:01+08:00", views: 1, likes: 0, comments: 0 }] });
    const r = applySeriesFilters(makeData([early, late]), { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2]);
  });

  test("latest：缺陷 publishedAt → 不崩潰、結果確定（NaN guard）", () => {
    // taipeiDay 是純字串切片：缺陷日期回傳 truthy（"not-a-date"），不落入「無文章」分支，
    // 與原 Dashboard 行為一致（parity）。guard 只防同日比較的 NaN 讓 sort 依賴引擎。
    const bad1 = makeSeries({ id: 1, articles: [{ id: 1, day: 1, title: "壞1", url: "u", publishedAt: "not-a-date", views: 1, likes: 0, comments: 0 }] });
    const good = makeSeries({ id: 2, articles: [{ id: 1, day: 1, title: "好", url: "u", publishedAt: "2026-08-01T12:00:00+08:00", views: 1, likes: 0, comments: 0 }] });
    const bad2 = makeSeries({ id: 3, articles: [{ id: 1, day: 1, title: "壞2", url: "u", publishedAt: "not-a-date", views: 1, likes: 0, comments: 0 }] });
    const data = makeData([bad1, good, bad2]);
    const r1 = applySeriesFilters(data, { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    const r2 = applySeriesFilters(data, { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    expect(r1).toHaveLength(3);
    expect(r1.map((s) => s.id)).toEqual(r2.map((s) => s.id)); // 確定性：兩次結果一致
  });

  test("tie 穩定度：相等 key 維持原順序（依賴 Array.sort 穩定）", () => {
    const a = makeSeries({ id: 1, dayCount: 5 });
    const b = makeSeries({ id: 2, dayCount: 5 });
    const c = makeSeries({ id: 3, dayCount: 5 });
    const r = applySeriesFilters(makeData([a, b, c]), { group: "全部", sort: "dayCount", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe("applySeriesFilters — 搜尋組合（spec §3.1：組別之後、排序之前）", () => {
  test("組別 + 搜尋交集：兩條件都符合才列出", () => {
    // 各系列給不同作者名：搜尋會命中 title/user/group/team，需避免 base 作者名（SQLMASTER）干擾。
    const a = makeSeries({ id: 1, group: "自我挑戰組", title: "SQL Server 基礎" });
    const b = makeSeries({ id: 2, group: "現代", title: "SQLite 深入", user: { id: 2, name: "B 作者", profileUrl: "u" } }); // 搜尋命中但組別不符
    const c = makeSeries({ id: 3, group: "自我挑戰組", title: "React 教學", user: { id: 3, name: "C 作者", profileUrl: "u" } }); // 組別符但搜尋不符
    const r = applySeriesFilters(makeData([a, b, c]), { group: "自我挑戰組", sort: "dayCount", query: "sql", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1]);
  });
  test("fav 分頁 + 搜尋交集", () => {
    const a = makeSeries({ id: 1, title: "Vue 實戰" });
    const b = makeSeries({ id: 2, title: "React 實戰" });
    const r = applySeriesFilters(makeData([a, b]), { group: "fav", sort: "dayCount", query: "vue", favSet: new Set([1, 2]) });
    expect(r.map((s) => s.id)).toEqual([1]);
  });
  test("空資料：回傳空陣列（不 throw）", () => {
    const r = applySeriesFilters(makeData([]), { group: "全部", sort: "dayCount", query: "", favSet: NO_FAV });
    expect(r).toEqual([]);
    const m = groupCounts(makeData([]));
    expect(m.get("全部")).toBe(0);
  });
  test("空 query / 全空白 → 搜尋關閉", () => {
    const a = makeSeries({ id: 1, title: "A" });
    const b = makeSeries({ id: 2, title: "B" });
    const r1 = applySeriesFilters(makeData([a, b]), { group: "全部", sort: "dayCount", query: "", favSet: NO_FAV });
    const r2 = applySeriesFilters(makeData([a, b]), { group: "全部", sort: "dayCount", query: "   ", favSet: NO_FAV });
    expect(r1.length).toBe(2);
    expect(r2.length).toBe(2);
  });
});

describe("純度", () => {
  test("不 mutate 輸入 series、回傳新陣列", () => {
    const a = makeSeries({ id: 1, dayCount: 1 });
    const b = makeSeries({ id: 2, dayCount: 2 });
    const data = makeData([a, b]);
    const before = data.series.map((s) => s.id);
    const r = applySeriesFilters(data, { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    expect(r).not.toBe(data.series);
    expect(data.series.map((s) => s.id)).toEqual(before);
  });
});

describe("helper 純函式", () => {
  test("groupCounts：全部 = series.length + 各組計數", () => {
    const data = makeData([
      makeSeries({ id: 1, group: "A" }),
      makeSeries({ id: 2, group: "A" }),
      makeSeries({ id: 3, group: "B" }),
    ]);
    const m = groupCounts(data);
    expect(m.get("全部")).toBe(3);
    expect(m.get("A")).toBe(2);
    expect(m.get("B")).toBe(1);
  });
  test("activeGroupFor：fav 恆保留；不存在的組別 → 全部；存在 → 保留", () => {
    const groups = ["全部", "A"];
    expect(activeGroupFor(groups, "fav")).toBe("fav");
    expect(activeGroupFor(groups, "B")).toBe("全部");
    expect(activeGroupFor(groups, "A")).toBe("A");
  });
  test("currentYearFavCount / favSeries：只算目前年度已收藏子集", () => {
    const a = makeSeries({ id: 1 });
    const b = makeSeries({ id: 2 });
    const data = makeData([a, b]);
    expect(favSeries(data, new Set([1])).map((s) => s.id)).toEqual([1]);
    expect(currentYearFavCount(data, new Set([1]))).toBe(1);
    expect(currentYearFavCount(data, new Set([99]))).toBe(0);
  });
});

describe("真實資料全量 sweep（data/2026.json）", () => {
  const data = realData as unknown as YearData;
  const favSet = new Set(data.series.slice(0, 5).map((s) => s.id));

  test(`全部（${data.series.length} 支）：數量不變、dayCount 單調遞減`, () => {
    const r = applySeriesFilters(data, { group: "全部", sort: "dayCount", query: "", favSet });
    expect(r.length).toBe(data.series.length);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].dayCount).toBeGreaterThanOrEqual(r[i].dayCount);
  });

  test("views：totalViewsOf 單調遞減", () => {
    const r = applySeriesFilters(data, { group: "全部", sort: "views", query: "", favSet });
    expect(r.length).toBe(data.series.length);
    for (let i = 1; i < r.length; i++) expect(totalViewsOf(r[i - 1])).toBeGreaterThanOrEqual(totalViewsOf(r[i]));
  });

  test("latest：有文章者全部排在無文章者之前，有文章段內臺北日非遞增", () => {
    const r = applySeriesFilters(data, { group: "全部", sort: "latest", query: "", favSet });
    const firstNoArticle = r.findIndex((s) => s.articles.length === 0);
    if (firstNoArticle !== -1) {
      for (let i = firstNoArticle; i < r.length; i++) expect(r[i].articles.length).toBe(0);
    }
    for (let i = 1; i < r.length; i++) {
      const prev = r[i - 1], cur = r[i];
      if (!prev.articles.length || !cur.articles.length) continue;
      const dp = prev.articles[prev.articles.length - 1].publishedAt.slice(0, 10);
      const dc = cur.articles[cur.articles.length - 1].publishedAt.slice(0, 10);
      expect(dp.localeCompare(dc)).toBeGreaterThanOrEqual(0);
    }
  });

  test("fav 子集：只含已收藏且存在於目前年度", () => {
    const r = applySeriesFilters(data, { group: "fav", sort: "dayCount", query: "", favSet });
    expect(r.length).toBe(currentYearFavCount(data, favSet));
    for (const s of r) expect(favSet.has(s.id)).toBe(true);
  });
});
