import { describe, expect, test } from "bun:test";
import {
  publishHourHistogram,
  publishWeekdayHistogram,
  viewsDistribution,
  topSeriesBySubscriptions,
  groupStats,
  titleKeywordStats,
  titleLengthDistribution,
  publishHeatmap,
  engagementLeaderboard,
  staleObservation,
} from "./insights";
import type { Article, Series } from "../../../scripts/types";

function article(partial: Partial<Article> & { publishedAt: string }): Article {
  return {
    id: 1, day: 1, title: "t", url: "https://example.com", views: 0, likes: 0, comments: 0,
    ...partial,
  };
}

function makeSeries(partial: Partial<Series>): Series {
  const base: Series = {
    id: 1,
    user: { id: 1, name: "u", profileUrl: "https://ithelp.ithome.com.tw/users/1" },
    group: "Modern Web", title: "t", description: "", team: null,
    signupDate: "2026-01-01T00:00:00+08:00", lastUpdated: null,
    dayCount: 5, articleCount: 5, subscriptions: 3, articles: [],
  };
  return { ...base, ...partial };
}

describe("publishHourHistogram", () => {
  test("空陣列 → 24 筆 count 0", () => {
    const h = publishHourHistogram([]);
    expect(h).toHaveLength(24);
    expect(h.every((x) => x.count === 0)).toBe(true);
    expect(h.map((x) => x.hour)).toEqual([...Array(24).keys()]);
  });
  test("單篇文章 hour 1 → 該時 1、其餘 0", () => {
    const h = publishHourHistogram([article({ publishedAt: "2026-08-01T01:00:00+08:00" })]);
    expect(h[1]).toEqual({ hour: 1, count: 1 });
    expect(h.filter((x) => x.count > 0)).toHaveLength(1);
  });
  test("多篇跨小時計數正確", () => {
    const arts = [
      article({ publishedAt: "2026-08-01T00:30:00+08:00" }),
      article({ publishedAt: "2026-08-02T00:10:00+08:00" }),
      article({ publishedAt: "2026-08-03T08:00:00+08:00" }),
      article({ publishedAt: "2026-08-04T08:30:00+08:00" }),
    ];
    const h = publishHourHistogram(arts);
    expect(h[0].count).toBe(2);
    expect(h[8].count).toBe(2);
  });
});

describe("publishWeekdayHistogram", () => {
  test("2026-08-01（週六）→ 六；2026-08-03（週一）→ 一", () => {
    const h = publishWeekdayHistogram([
      article({ publishedAt: "2026-08-01T12:00:00+08:00" }),
      article({ publishedAt: "2026-08-03T12:00:00+08:00" }),
    ]);
    expect(h).toEqual([
      { weekday: "一", count: 1 },
      { weekday: "二", count: 0 },
      { weekday: "三", count: 0 },
      { weekday: "四", count: 0 },
      { weekday: "五", count: 0 },
      { weekday: "六", count: 1 },
      { weekday: "日", count: 0 },
    ]);
  });
  test("跨日邊界：以臺北牆鐘為準（review #2）", () => {
    // 2026-08-02 臺北 23:30 → 日；2026-08-03 臺北 00:30 → 一（UTC 前一/當日）
    const h = publishWeekdayHistogram([
      article({ publishedAt: "2026-08-02T23:30:00+08:00" }),
      article({ publishedAt: "2026-08-03T00:30:00+08:00" }),
    ]);
    expect(h.find((x) => x.weekday === "日")!.count).toBe(1);
    expect(h.find((x) => x.weekday === "一")!.count).toBe(1);
  });
  test("空陣列 → 7 筆 count 0、順序固定", () => {
    const h = publishWeekdayHistogram([]);
    expect(h).toEqual([
      { weekday: "一", count: 0 }, { weekday: "二", count: 0 }, { weekday: "三", count: 0 },
      { weekday: "四", count: 0 }, { weekday: "五", count: 0 }, { weekday: "六", count: 0 },
      { weekday: "日", count: 0 },
    ]);
  });
});

describe("viewsDistribution", () => {
  test("p50/p90/p99 與 top10PctShare", () => {
    const d = viewsDistribution([
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 10 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 20 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 30 }),
    ]);
    expect(d.total).toBe(60);
    expect(d.max).toBe(30);
    expect(d.p50).toBe(20);
    expect(d.p90).toBe(30);
    expect(d.p99).toBe(30);
    expect(d.top10PctShare).toBeCloseTo(0.5); // 最高 1 篇（ceil(0.3)=1）：30/60
    expect(d.hasViews).toBe(true);
  });
  test("buckets 對數分桶（含 0 views 桶）", () => {
    const d = viewsDistribution([
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 0 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 7 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 103 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 8678 }),
    ]);
    expect(d.buckets).toEqual([
      { label: "0", count: 1 },
      { label: "1–9", count: 1 },
      { label: "10–99", count: 0 },
      { label: "100–999", count: 1 },
      { label: "1000–9999", count: 1 },
      { label: "10000+", count: 0 },
    ]);
  });
  test("全 0 views → hasViews false、top10PctShare 0", () => {
    const d = viewsDistribution([
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 0 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 0 }),
    ]);
    expect(d.hasViews).toBe(false);
    expect(d.top10PctShare).toBe(0);
    expect(d.buckets[0]).toEqual({ label: "0", count: 2 });
  });
  test("空陣列 → 全 0、hasViews false", () => {
    const d = viewsDistribution([]);
    expect(d.total).toBe(0);
    expect(d.top10PctShare).toBe(0);
    expect(d.hasViews).toBe(false);
    expect(d.buckets).toEqual([
      { label: "0", count: 0 },
      { label: "1–9", count: 0 },
      { label: "10–99", count: 0 },
      { label: "100–999", count: 0 },
      { label: "1000–9999", count: 0 },
      { label: "10000+", count: 0 },
    ]);
  });
});

describe("topSeriesBySubscriptions", () => {
  const sA = makeSeries({ id: 1, title: "A", subscriptions: 5, articles: [article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 100 })] });
  const sB = makeSeries({ id: 2, title: "B", subscriptions: 10, articles: [article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 50 })] });
  const sC = makeSeries({ id: 3, title: "C", subscriptions: 10, articles: [] });

  test("依 subscriptions desc", () => {
    expect(topSeriesBySubscriptions([sA, sB]).map((x) => x.name)).toEqual(["B", "A"]);
  });
  test("同值依 name asc", () => {
    expect(topSeriesBySubscriptions([sB, sC]).map((x) => x.name)).toEqual(["B", "C"]);
  });
  test("views = articles views 總和", () => {
    const top = topSeriesBySubscriptions([sA]);
    expect(top[0].views).toBe(100);
  });
  test("n 預設 10、超過系列數回傳全部；空 series → []", () => {
    expect(topSeriesBySubscriptions([])).toEqual([]);
    expect(topSeriesBySubscriptions([sA, sB], 1)).toHaveLength(1);
  });
});

describe("groupStats", () => {
  const g1a = makeSeries({ id: 1, group: "Web", subscriptions: 2, articles: [article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 100 })] });
  const g1b = makeSeries({ id: 2, group: "Web", subscriptions: 4, articles: [article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 300 })] });
  const g2 = makeSeries({ id: 3, group: "AI", subscriptions: 1, articles: [] });

  test("聚合 seriesCount/articleCount/totalSubscriptions", () => {
    const s = groupStats([g1a, g1b, g2]);
    const web = s.find((x) => x.group === "Web")!;
    expect(web.seriesCount).toBe(2);
    expect(web.articleCount).toBe(2);
    expect(web.totalSubscriptions).toBe(6);
    expect(web.avgViews).toBe(200); // 400/2
  });
  test("無文章組 avgViews = 0", () => {
    const s = groupStats([g2]);
    expect(s[0].avgViews).toBe(0);
  });
  test("排序 seriesCount desc，同值 group asc", () => {
    const s = groupStats([g1a, g1b, g2]);
    expect(s.map((x) => x.group)).toEqual(["Web", "AI"]);
  });
  test("空 series → []", () => {
    expect(groupStats([])).toEqual([]);
  });
});

describe("titleKeywordStats", () => {
  const kw = ["AI", "前端"];
  test("字典命中，每系列標題最多 1 次", () => {
    const s1 = makeSeries({ id: 1, title: "AI AI 前端" }); // AI 2 次、前端 1 次
    const s2 = makeSeries({ id: 2, title: "前端開發" });
    const stats = titleKeywordStats([s1, s2], kw);
    expect(stats.find((x) => x.keyword === "AI")!.count).toBe(1); // 只算 1
    expect(stats.find((x) => x.keyword === "前端")!.count).toBe(2);
  });
  test("大小寫正規化（ai 命中 AI）", () => {
    const stats = titleKeywordStats([makeSeries({ id: 1, title: "ai 入門" })], kw);
    expect(stats.find((x) => x.keyword === "AI")!.count).toBe(1);
  });
  test("只分析 Series.title，不混 description", () => {
    const stats = titleKeywordStats([makeSeries({ id: 1, title: "無關鍵字", description: "AI 教學" })], kw);
    expect(stats.every((x) => x.count === 0)).toBe(true);
  });
  test("英文關鍵詞不接受子字串誤判（review #1）", () => {
    // SAIL 含 AI 子字串，但 AI 是獨立 token → 不命中
    const stats = titleKeywordStats([makeSeries({ id: 1, title: "SAIL 入門" })], ["AI"]);
    expect(stats).toEqual([]);
  });
  test("英文關鍵詞 token 邊界命中", () => {
    const stats = titleKeywordStats([makeSeries({ id: 1, title: "AI 與 K8s 實戰" })], ["AI", "K8s"]);
    expect(stats.find((x) => x.keyword === "AI")!.count).toBe(1);
    expect(stats.find((x) => x.keyword === "K8s")!.count).toBe(1);
  });
  test("中文關鍵詞仍以子字串比對", () => {
    // 中文無 token 邊界；「前端開發」含「前端」
    const stats = titleKeywordStats([makeSeries({ id: 1, title: "前端開發" })], ["前端"]);
    expect(stats.find((x) => x.keyword === "前端")!.count).toBe(1);
  });
  test("排序 count desc，同值 keyword asc", () => {
    const stats = titleKeywordStats([
      makeSeries({ id: 1, title: "前端" }),
      makeSeries({ id: 2, title: "AI" }),
    ], kw);
    // localeCompare("zh-Hant")：中文在 ICU zh-Hant collation 下排在 ASCII 前（"前端" < "AI"）
    expect(stats.map((x) => x.keyword)).toEqual(["前端", "AI"]); // 各 1，依 asc
  });
  test("空 series → []", () => {
    expect(titleKeywordStats([])).toEqual([]);
  });
  test("純數字 / 英文停用詞關鍵詞排除（review #3 補強 1）", () => {
    // 自訂關鍵詞：2026（純數字）、the（停用詞）、AI（有效）
    const stats = titleKeywordStats(
      [makeSeries({ id: 1, title: "2026 the AI" })],
      ["2026", "the", "AI"],
    );
    expect(stats.map((x) => x.keyword)).toEqual(["AI"]);
    expect(stats.find((x) => x.keyword === "AI")!.count).toBe(1);
  });
});

describe("titleLengthDistribution", () => {
  test("分桶正確（5 字一桶）", () => {
    const dist = titleLengthDistribution([
      makeSeries({ id: 1, title: "短" }),                    // length 1 → 0–4
      makeSeries({ id: 2, title: "十個字十個字十個字十" }),   // length 10 → 10–14
      makeSeries({ id: 3, title: "二十個字二十個字二十個字二十個字二十個字" }), // length 20 → 20–24
    ]);
    expect(dist).toEqual([
      { length: "0–4", count: 1 },
      { length: "5–9", count: 0 },
      { length: "10–14", count: 1 },
      { length: "15–19", count: 0 },
      { length: "20–24", count: 1 },
      { length: "25–29", count: 0 },
      { length: "30–34", count: 0 },
      { length: "35–39", count: 0 },
      { length: "40+", count: 0 },
    ]);
  });
  test("空標題計入 0–4", () => {
    const dist = titleLengthDistribution([makeSeries({ id: 1, title: "" })]);
    expect(dist[0]).toEqual({ length: "0–4", count: 1 });
  });
  test("String.length 計算（UTF-16 code unit，emoji 算 2）", () => {
    // "A😀" length = 3（A=1 + emoji surrogate pair=2）
    const dist = titleLengthDistribution([makeSeries({ id: 1, title: "A😀" })]);
    expect("A😀".length).toBe(3);
    expect(dist[0]).toEqual({ length: "0–4", count: 1 });
  });
  test("空 series → 9 桶全 0", () => {
    const dist = titleLengthDistribution([]);
    expect(dist).toEqual([
      { length: "0–4", count: 0 },
      { length: "5–9", count: 0 },
      { length: "10–14", count: 0 },
      { length: "15–19", count: 0 },
      { length: "20–24", count: 0 },
      { length: "25–29", count: 0 },
      { length: "30–34", count: 0 },
      { length: "35–39", count: 0 },
      { length: "40+", count: 0 },
    ]);
  });
});

describe("publishHeatmap", () => {
  test("空陣列 → 168 格全 0、星期 7 列、小時 24 欄", () => {
    const h = publishHeatmap([]);
    expect(h.weekdays).toHaveLength(7);
    expect(h.hours).toHaveLength(24);
    expect(h.data).toHaveLength(168);
    expect(h.data.every(([, , c]) => c === 0)).toBe(true);
  });
  test("週六 00 時 + 週一 09 時各 1 篇", () => {
    // 2026-08-01 = 週六（idx 5）；2026-08-03 = 週一（idx 0）
    const h = publishHeatmap([
      article({ publishedAt: "2026-08-01T00:30:00+08:00" }),
      article({ publishedAt: "2026-08-03T09:00:00+08:00" }),
    ]);
    expect(h.data.find(([x, y]) => x === 0 && y === 5)![2]).toBe(1);
    expect(h.data.find(([x, y]) => x === 9 && y === 0)![2]).toBe(1);
    const nonzero = h.data.filter(([, , c]) => c > 0);
    expect(nonzero).toHaveLength(2);
  });
  test("格式錯誤 publishedAt 跳過", () => {
    const h = publishHeatmap([article({ publishedAt: "not-a-date" })]);
    expect(h.data.every(([, , c]) => c === 0)).toBe(true);
  });
});

describe("engagementLeaderboard", () => {
  const viewArt = (views: number, likes = 0, comments = 0): Article =>
    article({ publishedAt: "2026-08-01T00:00:00+08:00", views, likes, comments });
  test("依 likeRate 降序、過濾低 views、limit", () => {
    const series = [
      makeSeries({ title: "高轉換", articles: [viewArt(100, 10)] }), // 10%
      makeSeries({ id: 2, title: "低轉換", articles: [viewArt(200, 2)] }), // 1%
      makeSeries({ id: 3, title: "流量低", articles: [viewArt(40, 5)] }), // 低於 minViews 50
    ];
    const r = engagementLeaderboard(series, { minViews: 50, limit: 10 });
    expect(r.map((x) => x.title)).toEqual(["高轉換", "低轉換"]);
    expect(r[0].likeRate).toBeCloseTo(0.1);
  });
  test("metric=commentRate 改依留言率排序", () => {
    const series = [
      makeSeries({ title: "多留言", articles: [viewArt(100, 0, 5)] }), // 5%
      makeSeries({ id: 2, title: "多按讚", articles: [viewArt(100, 20, 0)] }), // like 20%, comment 0
    ];
    const r = engagementLeaderboard(series, { minViews: 50, metric: "commentRate" });
    expect(r[0].title).toBe("多留言");
  });
  test("無文章系列排除", () => {
    expect(engagementLeaderboard([makeSeries({ articles: [] })])).toEqual([]);
  });
});

describe("staleObservation", () => {
  const today = "2026-08-21";
  test("連續兩天未發文才列入，並顯示最後完成日與停更天數", () => {
    const rows = staleObservation([
      makeSeries({ id: 1, title: "Day 3", dayCount: 3, articles: [article({ publishedAt: "2026-08-19T10:00:00+08:00" })] }),
      makeSeries({ id: 2, title: "昨天", dayCount: 8, articles: [article({ publishedAt: "2026-08-20T10:00:00+08:00" })] }),
    ], today);
    expect(rows).toEqual([{ title: "Day 3", author: "u", group: "Modern Web", dayCount: 3, staleDays: 2 }]);
  });
  test("排除尚未開賽、完賽與無法判定日期的系列", () => {
    expect(staleObservation([
      makeSeries({ dayCount: 0, articles: [] }),
      makeSeries({ dayCount: 30, articles: [article({ publishedAt: "2026-08-10T10:00:00+08:00" })] }),
      makeSeries({ dayCount: 5, articles: [article({ publishedAt: "invalid" })] }),
    ], today)).toEqual([]);
  });
  test("依 dayCount asc、同日數依 staleDays desc", () => {
    const rows = staleObservation([
      makeSeries({ id: 1, title: "後斷", dayCount: 8, articles: [article({ publishedAt: "2026-08-17T10:00:00+08:00" })] }),
      makeSeries({ id: 2, title: "早斷", dayCount: 3, articles: [article({ publishedAt: "2026-08-19T10:00:00+08:00" })] }),
    ], today);
    expect(rows.map((r) => r.title)).toEqual(["早斷", "後斷"]);
  });
  test("同 dayCount 時 staleDays 降序", () => {
    const rows = staleObservation([
      makeSeries({ id: 1, title: "較久", dayCount: 3, articles: [article({ publishedAt: "2026-08-18T10:00:00+08:00" })] }),
      makeSeries({ id: 2, title: "較近", dayCount: 3, articles: [article({ publishedAt: "2026-08-19T10:00:00+08:00" })] }),
    ], today);
    expect(rows.map((r) => r.title)).toEqual(["較久", "較近"]);
  });
  test("today 之前的日期不列入", () => {
    expect(staleObservation([
      makeSeries({ articles: [article({ publishedAt: "2026-08-22T10:00:00+08:00" })] }),
    ], today)).toEqual([]);
  });
});
