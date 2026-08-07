// web/src/lib/insights.ts — 純函數、無 DOM、無 window、無 runtime 依賴。
// YearData / Series / Article 型別權威：scripts/types.ts（與 Dashboard.astro 同路徑慣例）。
import type { Article, Series } from "../../../scripts/types";
import { DEFAULT_KEYWORDS, ENGLISH_STOPWORDS } from "./keywords"; // Task 2 新增

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
  top10PctShare: number; hasViews: boolean; buckets: { label: string; count: number }[];
};

const BUCKETS: { label: string; test: (v: number) => boolean }[] = [
  { label: "0", test: (v) => v === 0 },
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
  const hasViews = total > 0;
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
    hasViews,
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

export function groupStats(
  series: Series[],
): { group: string; seriesCount: number; articleCount: number; avgViews: number; totalSubscriptions: number }[] {
  const byGroup = new Map<string, Series[]>();
  for (const s of series) {
    const list = byGroup.get(s.group) ?? [];
    list.push(s);
    byGroup.set(s.group, list);
  }
  const rows = [...byGroup.entries()].map(([group, list]) => {
    const articles = list.flatMap((s) => s.articles);
    const totalViews = articles.reduce((sum, a) => sum + a.views, 0);
    return {
      group,
      seriesCount: list.length,
      articleCount: articles.length,
      avgViews: articles.length === 0 ? 0 : Math.round(totalViews / articles.length),
      totalSubscriptions: list.reduce((sum, s) => sum + s.subscriptions, 0),
    };
  });
  rows.sort((a, b) => b.seriesCount - a.seriesCount || a.group.localeCompare(b.group, "zh-Hant"));
  return rows;
}

// 英文/數字連續字串 token（spec §3.3、review #1）；AI 不命中 SAIL。
const ASCII_TOKEN = /[A-Za-z0-9]+/g;
const STOPWORD_SET = new Set(ENGLISH_STOPWORDS);

function isAsciiKeyword(k: string): boolean {
  return /^[A-Za-z0-9]+$/.test(k);
}

// 關鍵詞排除：純數字（/^\d+$/）或英文停用詞（大小寫不敏感）→ 不列入統計（review #3 補強 1）。
function isExcludedKeyword(k: string): boolean {
  const lower = k.toLowerCase();
  return /^\d+$/.test(k) || STOPWORD_SET.has(lower);
}

export function titleKeywordStats(
  series: Series[],
  keywords: string[] = DEFAULT_KEYWORDS,
): { keyword: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const k of keywords) {
    if (isExcludedKeyword(k)) continue; // 排除純數字 / 停用詞（對任何傳入 keywords 生效）
    counts.set(k, 0);
  }
  for (const s of series) {
    const title = s.title.toLowerCase();
    for (const k of counts.keys()) {
      let hit: boolean;
      if (isAsciiKeyword(k)) {
        // token 邊界命中：標題的英數 token 集合含該關鍵詞（大小寫已正規化）
        hit = title.match(ASCII_TOKEN)?.includes(k.toLowerCase()) ?? false;
      } else {
        // 中文關鍵詞：大小寫正規化後子字串比對（無 token 邊界）
        hit = title.includes(k.toLowerCase());
      }
      if (hit) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, "zh-Hant"));
}

// 標題長度分桶（spec §4.2、review #3 blocking）：String.length（UTF-16 code unit）。
const LENGTH_BUCKETS = [
  { label: "0–4", test: (n: number) => n >= 0 && n <= 4 },
  { label: "5–9", test: (n: number) => n >= 5 && n <= 9 },
  { label: "10–14", test: (n: number) => n >= 10 && n <= 14 },
  { label: "15–19", test: (n: number) => n >= 15 && n <= 19 },
  { label: "20–24", test: (n: number) => n >= 20 && n <= 24 },
  { label: "25–29", test: (n: number) => n >= 25 && n <= 29 },
  { label: "30–34", test: (n: number) => n >= 30 && n <= 34 },
  { label: "35–39", test: (n: number) => n >= 35 && n <= 39 },
  { label: "40+", test: (n: number) => n >= 40 },
];

export function titleLengthDistribution(
  series: Series[],
): { length: string; count: number }[] {
  return LENGTH_BUCKETS.map((b) => ({
    length: b.label,
    count: series.filter((s) => b.test(s.title.length)).length,
  }));
}


// 棄賽進度分佈：series.dayCount 分六桶（每 5 天），看出棄賽斷崖。
export function dayCountDistribution(series: Series[]): { label: string; count: number }[] {
  const buckets = [
    { label: "1–5",   min: 0,  max: 5  },
    { label: "6–10",  min: 6,  max: 10 },
    { label: "11–15", min: 11, max: 15 },
    { label: "16–20", min: 16, max: 20 },
    { label: "21–25", min: 21, max: 25 },
    { label: "26–30", min: 26, max: 30 },
  ];
  return buckets.map((b) => ({
    label: b.label,
    count: series.filter((s) => s.dayCount >= b.min && s.dayCount <= b.max).length,
  }));
}

// 文章觀看 CDF：每 5 百分位一點（共 21 點），揭露長尾分佈。
export function viewsPercentiles(articles: Article[]): { pct: number; views: number }[] {
  if (articles.length === 0) return [];
  const sorted = articles.map((a) => a.views).sort((a, b) => a - b);
  const n = sorted.length;
  return Array.from({ length: 21 }, (_, i) => {
    const pct = i * 5;
    const idx = Math.min(Math.floor((pct / 100) * n), n - 1);
    return { pct, views: sorted[idx] };
  });
}

// ── 發文熱力圖：星期 × 小時（7 列 × 24 欄）──────────────────────────────
// weekdayIdx 一=0…日=6（同 WEEKDAY_ORDER）；hour 0–23。
export type HeatmapPoint = [hour: number, weekdayIdx: number, count: number];
export function publishHeatmap(
  articles: Article[],
): { weekdays: string[]; hours: number[]; data: HeatmapPoint[] } {
  const grid = new Array(7 * 24).fill(0);
  for (const a of articles) {
    const hour = Number(a.publishedAt.slice(11, 13));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const wd = taipeiWeekday(a.publishedAt.slice(0, 10));
    const y = WEEKDAY_ORDER.indexOf(wd);
    if (y < 0) continue;
    grid[y * 24 + hour]++;
  }
  const data: HeatmapPoint[] = [];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 24; x++) data.push([x, y, grid[y * 24 + x]]);
  return { weekdays: [...WEEKDAY_ORDER], hours: [...Array(24).keys()], data };
}

// ── 互動轉換率排行：以系列聚合 views→likes / views→comments ──────────────
export type EngagementRow = {
  title: string; author: string; group: string;
  views: number; likes: number; comments: number;
  likeRate: number; commentRate: number;
};
export function engagementLeaderboard(
  series: Series[],
  opts: { minViews?: number; metric?: "likeRate" | "commentRate"; limit?: number } = {},
): EngagementRow[] {
  const minViews = opts.minViews ?? 50;
  const metric = opts.metric ?? "likeRate";
  const limit = opts.limit ?? 10;
  const rows: EngagementRow[] = series
    .filter((s) => s.articles.length > 0)
    .map((s) => {
      const views = s.articles.reduce((a, x) => a + x.views, 0);
      const likes = s.articles.reduce((a, x) => a + x.likes, 0);
      const comments = s.articles.reduce((a, x) => a + x.comments, 0);
      return {
        title: s.title, author: s.user.name, group: s.group,
        views, likes, comments,
        likeRate: views > 0 ? likes / views : 0,
        commentRate: views > 0 ? comments / views : 0,
      };
    })
    .filter((r) => r.views >= minViews)
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
  return rows;
}

// ── 斷更風險：報名日 → 快照日應有天數 vs 實際 dayCount 的落差 ───────────
// signupDate/updatedAt 皆為臺北牆鐘（+08:00）；日期差以兩端 YYYY-MM-DD 的 UTC 午夜
// 計算（環境時區無關）。expected = 報名至快照經過天數（clamped 0–30）；
export type ScheduleRow = {
  title: string; author: string; group: string;
  dayCount: number; expected: number; deficit: number;
};
export function behindSchedule(series: Series[], updatedAt: string): ScheduleRow[] {
  const snap = updatedAt.replace(/\//g, "-").slice(0, 10);
  const snapMs = Date.parse(`${snap}T00:00:00Z`);
  if (!Number.isFinite(snapMs)) return [];
  const DAY = 86400000;
  return series
    .map((s) => {
      const sup = s.signupDate.replace(/\//g, "-").slice(0, 10);
      const supMs = Date.parse(`${sup}T00:00:00Z`);
      const expected = Number.isFinite(supMs)
        ? Math.max(0, Math.min(30, Math.round((snapMs - supMs) / DAY)))
        : 0;
      const deficit = Math.max(0, expected - s.dayCount);
      return {
        title: s.title, author: s.user.name, group: s.group,
        dayCount: s.dayCount, expected, deficit,
      };
    })
    .filter((r) => r.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || a.dayCount - b.dayCount);
}