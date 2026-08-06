// web/src/lib/insights.ts — 純函數、無 DOM、無 window、無 runtime 依賴。
// YearData / Series / Article 型別權威：scripts/types.ts（與 Dashboard.astro 同路徑慣例）。
import type { Article, Series } from "../../../scripts/types";

export function publishHourHistogram(articles: Article[]): { hour: number; count: number }[] {
  const counts = new Array(24).fill(0);
  for (const a of articles) {
    const hour = Number(a.publishedAt.slice(11, 13));
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) counts[hour]++;
  }
  return counts.map((count, hour) => ({ hour, count }));
}

const WEEKDAY_ORDER = ["一", "二", "三", "四", "五", "六", "日"];

// 臺北牆鐘（UTC+08:00）的星期：由 publishedAt 前 10 字元日期（YYYY-MM-DD）推導，
// 不依 runtime local timezone（review #2）。以 T00:00:00Z 解析日期字串取 UTC 星期
// （getUTCDay 與環境時區無關），0=日…6=六 → 對映 WEEKDAY_ORDER 索引 (day+6)%7。
function taipeiWeekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY_ORDER[(d.getUTCDay() + 6) % 7];
}

export function publishWeekdayHistogram(articles: Article[]): { weekday: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of WEEKDAY_ORDER) counts.set(w, 0);
  for (const a of articles) {
    const w = taipeiWeekday(a.publishedAt.slice(0, 10));
    if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return WEEKDAY_ORDER.map((weekday) => ({ weekday, count: counts.get(weekday) ?? 0 }));
}

export type ViewsDistribution = {
  total: number; max: number; p50: number; p90: number; p99: number;
  top10PctShare: number; buckets: { label: string; count: number }[];
};

const BUCKETS: { label: string; test: (v: number) => boolean }[] = [
  { label: "1–9", test: (v) => v >= 1 && v <= 9 },
  { label: "10–99", test: (v) => v >= 10 && v <= 99 },
  { label: "100–999", test: (v) => v >= 100 && v <= 999 },
  { label: "1000–9999", test: (v) => v >= 1000 && v <= 9999 },
  { label: "10000+", test: (v) => v >= 10000 },
];

export function viewsDistribution(articles: Article[]): ViewsDistribution {
  const views = articles.map((a) => a.views);
  const n = views.length;
  const total = views.reduce((s, v) => s + v, 0);
  const sorted = [...views].sort((a, b) => a - b);
  const pct = (idx: number) => (n === 0 ? 0 : sorted[Math.min(Math.floor(idx * n), n - 1)]);
  const topN = Math.ceil(n * 0.1);
  const topViews = sorted.slice(-topN).reduce((s, v) => s + v, 0);
  return {
    total,
    max: n === 0 ? 0 : sorted[n - 1],
    p50: pct(0.5),
    p90: pct(0.9),
    p99: pct(0.99),
    top10PctShare: total === 0 ? 0 : topViews / total,
    buckets: BUCKETS.map((b) => ({ label: b.label, count: views.filter(b.test).length })),
  };
}

export function topSeriesBySubscriptions(
  series: Series[],
  n = 10,
): { name: string; subscriptions: number; dayCount: number; views: number }[] {
  const rows = series.map((s) => ({
    name: s.title,
    subscriptions: s.subscriptions,
    dayCount: s.dayCount,
    views: s.articles.reduce((sum, a) => sum + a.views, 0),
  }));
  rows.sort((a, b) => b.subscriptions - a.subscriptions || a.name.localeCompare(b.name, "zh-Hant"));
  return rows.slice(0, n);
}
