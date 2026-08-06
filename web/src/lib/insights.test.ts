import { describe, expect, test } from "bun:test";
import {
  publishHourHistogram,
  publishWeekdayHistogram,
  viewsDistribution,
  topSeriesBySubscriptions,
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
    signupDate: "2026-01-01", lastUpdated: null,
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
  });
  test("buckets 對數分桶", () => {
    const d = viewsDistribution([
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 7 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 103 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 8678 }),
      article({ publishedAt: "2026-08-01T00:00:00+08:00", views: 0 }),
    ]);
    expect(d.buckets).toEqual([
      { label: "1–9", count: 1 },
      { label: "10–99", count: 0 },
      { label: "100–999", count: 1 },
      { label: "1000–9999", count: 1 },
      { label: "10000+", count: 0 },
    ]);
  });
  test("空陣列 → 全 0", () => {
    const d = viewsDistribution([]);
    expect(d.total).toBe(0);
    expect(d.top10PctShare).toBe(0);
    expect(d.buckets.every((b) => b.count === 0)).toBe(true);
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
