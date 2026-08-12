// filter.ts 資料層測試：fav 子集 → 組別 → 搜尋 → 排序的語意契約。
// 這是全專案最後一塊原本無測試的商業邏輯（排序語意跨 search/daily-status/favorites 三個 spec）。
import { describe, expect, test } from "bun:test";
import type { Series, YearData } from "../../../scripts/types";
import { applySeriesFilters, activeGroupFor, currentYearFavCount, favSeries, groupCounts } from "./filter";
import { totalViewsOf } from "./card";
import { taipeiDay } from "./daily-status";
import realData from "../../../data/2026.json";

const NO_FAV = new Set<number>();

function makeSeries(partial: Partial<Series> & { sumViews?: number; todayMaxViews?: number }): Series & { sumViews?: number; todayMaxViews?: number } {
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

function makeData(series: (Series & { sumViews?: number; todayMaxViews?: number })[], updatedAt = "2026-08-07T13:23:00+08:00"): YearData {
  return {
    year: 2026,
    updatedAt,
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

describe("applySeriesFilters — team: 前綴組別過濾", () => {
  test("team:名稱 → 只列出該隊成員系列", () => {
    const s1 = makeSeries({ id: 1, team: "五人成行，Bug 不行", title: "A" });
    const s2 = makeSeries({ id: 2, team: "五人成行，Bug 不行", title: "B" });
    const s3 = makeSeries({ id: 3, team: "不買股票買機票", title: "C" });
    const data = makeData([s1, s2, s3]);
    const out = applySeriesFilters(data, { group: "team:五人成行，Bug 不行", sort: "dayCount", query: "", favSet: NO_FAV });
    expect(out.map((s) => s.id)).toEqual([1, 2]);
  });
  test("team: 與搜尋交集", () => {
    const s1 = makeSeries({ id: 1, team: "T", title: "React 教學" });
    const s2 = makeSeries({ id: 2, team: "T", title: "Vue 教學" });
    const data = makeData([s1, s2]);
    const out = applySeriesFilters(data, { group: "team:T", sort: "dayCount", query: "vue", favSet: NO_FAV });
    expect(out.map((s) => s.id)).toEqual([2]);
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

  test("latest：無文章（dayCount 0）→ 依報名日近者在前（早報名優先）", () => {
    const late = makeSeries({ id: 1, dayCount: 0, articleCount: 0, articles: [], signupDate: "2026/08/05T12:00:00+08:00" });
    const early = makeSeries({ id: 2, dayCount: 0, articleCount: 0, articles: [], signupDate: "2026/08/01T12:00:00+08:00" });
    const r = applySeriesFilters(makeData([late, early]), { group: "全部", sort: "latest", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([2, 1]); // 早報名在前
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

  test("todayViews：今日文章最大觀看 desc；無今日文章沉底依進度", () => {
    // makeData 快照日 = 2026-08-07 → 錨點日 2026-08-07。
    const a = makeSeries({ id: 1, dayCount: 7, articles: [{ id: 7, day: 7, title: "A今", url: "u", publishedAt: "2026-08-07T13:00:00+08:00", views: 50, likes: 0, comments: 0 }] });
    const b = makeSeries({ id: 2, dayCount: 6, articles: [{ id: 6, day: 6, title: "B昨", url: "u", publishedAt: "2026-08-06T13:00:00+08:00", views: 999, likes: 0, comments: 0 }] }); // 昨天 999 觀看 → 不算今日
    const c = makeSeries({ id: 3, dayCount: 5, articles: [{ id: 5, day: 5, title: "C前", url: "u", publishedAt: "2026-08-05T13:00:00+08:00", views: 9999, likes: 0, comments: 0 }] }); // 前天 → 無今日文章
    const r = applySeriesFilters(makeData([c, a, b]), { group: "全部", sort: "todayViews", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2, 3]); // 今日者在前（50）、無今日者依進度（6 > 5）
  });

  test("todayViews：同日多篇取最大觀看（非最新一篇）", () => {
    const a = makeSeries({ id: 1, dayCount: 7, articles: [
      { id: 7, day: 7, title: "A今低", url: "u", publishedAt: "2026-08-07T20:00:00+08:00", views: 10, likes: 0, comments: 0 }, // 最新但觀看低
      { id: 6, day: 6, title: "A今高", url: "u", publishedAt: "2026-08-07T09:00:00+08:00", views: 80, likes: 0, comments: 0 }, // 較早但觀看高
    ] });
    const b = makeSeries({ id: 2, dayCount: 6, articles: [{ id: 6, day: 6, title: "B今", url: "u", publishedAt: "2026-08-07T12:00:00+08:00", views: 60, likes: 0, comments: 0 }] });
    const r = applySeriesFilters(makeData([b, a]), { group: "全部", sort: "todayViews", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2]); // a 最大 80 > b 60
  });

  test("todayViews：compact todayMaxViews 優先於 articles 推導", () => {
    // 模擬 frontmatter compact 資料：帶 todayMaxViews，articles 只剩最新一篇（觀看不同）。
    const a = makeSeries({ id: 1, dayCount: 7, todayMaxViews: 90, articles: [{ id: 7, day: 7, title: "A", url: "u", publishedAt: "2026-08-07T13:00:00+08:00", views: 30, likes: 0, comments: 0 }] });
    const b = makeSeries({ id: 2, dayCount: 6, articles: [{ id: 6, day: 6, title: "B", url: "u", publishedAt: "2026-08-07T12:00:00+08:00", views: 70, likes: 0, comments: 0 }] });
    const r = applySeriesFilters(makeData([b, a]), { group: "全部", sort: "todayViews", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2]); // a 用 90（非 30）
  });

  test("todayViews：平手 → 有今日文章者在前；兩者皆有今日文章 → 穩定序", () => {
    // a 今日文章 views 0（今日發文但觀看 0）→ 仍算今日有發文；c 無今日文章 → 沉底依進度。
    const a = makeSeries({ id: 1, dayCount: 2, articles: [{ id: 1, day: 1, title: "A0", url: "u", publishedAt: "2026-08-07T09:00:00+08:00", views: 0, likes: 0, comments: 0 }] });
    const b = makeSeries({ id: 2, dayCount: 8, articles: [{ id: 1, day: 1, title: "B昨", url: "u", publishedAt: "2026-08-06T09:00:00+08:00", views: 0, likes: 0, comments: 0 }] }); // 昨天 → 無今日文章
    const c = makeSeries({ id: 3, dayCount: 3, articles: [{ id: 1, day: 1, title: "C昨", url: "u", publishedAt: "2026-08-06T09:00:00+08:00", views: 0, likes: 0, comments: 0 }] });
    const r = applySeriesFilters(makeData([b, a, c]), { group: "全部", sort: "todayViews", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([1, 2, 3]); // a 今日 0 → 前；b、c 無今日依進度（8 > 3）
  });

  test("todayViews：快照日錨點——非 updatedAt 日的文章不算今日", () => {
    // 快照日 2026-08-06：a 的文章在 8/5（不算今日）、b 在 8/6（算今日）→ b 在前。
    const a = makeSeries({ id: 1, dayCount: 5, articles: [{ id: 5, day: 5, title: "A05", url: "u", publishedAt: "2026-08-05T13:00:00+08:00", views: 777, likes: 0, comments: 0 }] });
    const b = makeSeries({ id: 2, dayCount: 5, articles: [{ id: 5, day: 5, title: "B06", url: "u", publishedAt: "2026-08-06T13:00:00+08:00", views: 10, likes: 0, comments: 0 }] });
    const r = applySeriesFilters(makeData([a, b], "2026-08-06T23:30:00+08:00"), { group: "全部", sort: "todayViews", query: "", favSet: NO_FAV });
    expect(r.map((s) => s.id)).toEqual([2, 1]); // b 今日 10 → 前；a 昨日 777 不算今日 → 沉底
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
  test("activeGroupFor：fav 與 teams 恆保留；不存在的組別 → 全部；存在 → 保留", () => {
    const groups = ["全部", "A"];
    expect(activeGroupFor(groups, "fav")).toBe("fav");
    // 「teams」= 計分板視圖入口 chip，年度切換時恆保留（不得 fallback 全部）
    expect(activeGroupFor(groups, "teams")).toBe("teams");
    expect(activeGroupFor(groups, "B")).toBe("全部");
    expect(activeGroupFor(groups, "A")).toBe("A");
  });
  test("activeGroupFor：認識 team: 前綴（有 teamNames 時）；不傳 teamNames → fallback 全部", () => {
    const groups = ["全部", "Modern Web"];
    // 存在 → 保留 requested；不存在 → fallback「全部」
    expect(activeGroupFor(groups, "team:五人成行，Bug 不行", ["五人成行，Bug 不行"])).toBe("team:五人成行，Bug 不行");
    expect(activeGroupFor(groups, "team:不存在的隊", ["五人成行，Bug 不行"])).toBe("全部");
    // 不傳 teamNames（既有呼叫）→ team: 前綴視為不存在 → fallback 全部（語意不變）
    expect(activeGroupFor(groups, "team:五人成行，Bug 不行")).toBe("全部");
    // fav 與普通組別語意不變
    expect(activeGroupFor(groups, "fav")).toBe("fav");
    expect(activeGroupFor(groups, "Modern Web")).toBe("Modern Web");
    expect(activeGroupFor(groups, "Missing")).toBe("全部");
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

  test("todayViews：有今日文章者全部排在無今日文章者之前，今日段內觀看單調遞減", () => {
    const anchor = data.updatedAt.slice(0, 10); // 快照日（與 applySeriesFilters 內部錨點一致）
    const r = applySeriesFilters(data, { group: "全部", sort: "todayViews", query: "", favSet });
    // 手算今日最大觀看：與實作同式（taipeiDay + max over 今日）。
    const hasToday = (s: (typeof data.series)[number]) =>
      s.articles.some((a) => a.publishedAt.slice(0, 10) === anchor);
    const firstNoToday = r.findIndex((s) => !hasToday(s));
    if (firstNoToday !== -1) {
      for (let i = firstNoToday; i < r.length; i++) expect(hasToday(r[i])).toBe(false);
    }
    for (let i = 1; i < r.length; i++) {
      const prev = r[i - 1], cur = r[i];
      const pv = hasToday(prev) ? Math.max(0, ...prev.articles.filter((a) => a.publishedAt.slice(0, 10) === anchor).map((a) => a.views)) : 0;
      const cv = hasToday(cur) ? Math.max(0, ...cur.articles.filter((a) => a.publishedAt.slice(0, 10) === anchor).map((a) => a.views)) : 0;
      if (pv === 0 && cv === 0) continue; // 皆無今日 → 依進度（非單調，跳過）
      expect(pv).toBeGreaterThanOrEqual(cv);
    }
  });
});
