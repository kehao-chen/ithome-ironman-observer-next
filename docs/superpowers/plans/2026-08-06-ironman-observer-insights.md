# 鐵人觀察家 Insights 分頁 + History Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/insights/` 分頁，用 SSG SVG 圖表呈現發文行為、人氣結構、組別分析、文字分析四個面板（client-side 年切換）；並讓 scraper 每次成功後把當日全量資料另存到 `data/history/{year}/{date}.json` 累積時間序列資料。

**Architecture:** 純函式計算層 `lib/insights.ts`（YearData → 可序列化統計）+ `lib/charts.ts`（統計 → SVG markup 字串，唯一 SVG 來源，SSG 與 client 共用，外部資料一律 XML escaping）。Astro 元件 `Insights.astro` SSG 預渲染 latestYear；年切換用 client-side `fetch('/data/{year}.json')` + `replaceState('?year=N')` 重繪（沿用 Dashboard 的 fetchToken 防競態）。History snapshot 在 CLI 取得 succeeded 後、stageWrites 前獨立寫入（不綁 atomic commit，失敗不擋主檔）。

**Tech Stack:** Bun（test runner）、Astro 5（SSG + inline script + `define:vars`）、TypeScript（型別權威 `scripts/types.ts`）、原生 CSS（design-system.css tokens）。

## Global Constraints

- **零 runtime 依賴**：client-side 不新增任何 library / dependency；圖表全為 SSG SVG + 原生 `<title>`（spec §2、§4.2）。
- **XSS / markup 正確性**：所有進入 SVG/XML attribute、`<title>`、文字節點的外部資料（系列標題、組別名）**必須 XML escaping**（`& < > " '`），不可未 escaping 插入 SVG 字串（spec §4.3）。`lib/charts.ts` 是唯一 SVG 產生來源。
- **繁中 only**：所有 UI 文案繁體中文（spec 全篇）。
- **型別直接 import**：`import type { Series, YearData } from "../../../scripts/types"`（relative 到 `web/src/lib/`）；禁止複製型別或改用 `any`。
- **`meta.years` 是唯一可選年度來源**；history 快照**不進** `meta.years`、不影響年切換器（spec §3.1、§4.1）。
- **年切換不得用 query param 驅動 SSR**：Astro `output: "static"` 下 `/insights/?year=N` 不會重跑 frontmatter（spec §4.1）；一律 client-side fetch + `replaceState`。
- **文字分析只分析 `Series.title`**：不混入 `Series.description` / `Article.title`；每系列標題對同關鍵字最多計 1（spec §3.3）。
- **英文關鍵詞 token 邊界命中**：英文/數字連續字串（`/[A-Za-z0-9]+/`）切 token 後比對，**不接受子字串誤判**（`AI` 不得命中 `SAIL`）；中文關鍵詞用大小寫正規化後的字典子字串比對（review #1）。
- **發文行為統計以臺北牆鐘（UTC+08:00）為準**：`publishedAt` 的 hour / weekday 統計**不得依 runtime local timezone**（review #2）；`weekday` 由 `publishedAt` 前 10 字元日期推導，不用 `new Date().getDay()` 的環境時區。
- **「星期分佈」語意**：`publishWeekdayHistogram` 輸出七日（一…日），所有 UI 文案用「星期分佈」，**不用「週末/平日」二分類**（review #9）。
- **觀看分佈用分桶長條圖，不建立泛用 LineChart**（spec §4.3）。
- **History snapshot 語意**：代表「一次成功完成的 scrape 結果」，與主檔 atomic commit 不綁定；寫入失敗僅 `console.error`、不阻止主檔 commit（spec §5.2）。
- **臺北日期**：快照檔名日期取自 `updatedAt` 的臺北時區日期（`taipeiTimestamp` 日期部分），不得用 runner local timezone（spec §5.2）。
- **不修改**：`scripts/parse-*.ts`、`scripts/fetch-html.ts`、`scripts/types.ts`、`.github/workflows/scheduled-update.yml`（`git add data/` 已涵蓋 `data/history/**`）、`SeriesCard.astro`、`daily-status.ts`、`favorites.ts`、`search.ts`（spec 未要求）。
- **測試用 bun:test**：`import { describe, expect, test } from "bun:test"`（既有慣例）；每個 Task 先寫 failing test 再實作。
- **innerHTML 例外縮到最小**：`el.innerHTML = svg` 僅允許用於 `charts.ts` 回傳的完整 `<svg>` 字串（受信任本地產生，已 XML escaping），是**唯一** innerHTML sink；所有文字洞察句一律 `textContent`；`set:html` 僅用於 charts.ts 的 SVG 輸出（review #8）。
- **`(window as any)` 限縮**：僅允許在讀 `window.INSIGHTS_DATA` / `INSIGHTS_YEARS` 兩處使用並加註解（Astro define:vars 注入的非標準 window property）；其餘程式碼禁止 `any`（review #8）。

---

### Task 1: 計算層 — 發文行為 + 人氣結構（TDD）

**Files:**
- Create: `web/src/lib/insights.ts`
- Test: `web/src/lib/insights.test.ts`

**Interfaces:**
- Consumes: `import type { YearData, Series, Article } from "../../../scripts/types"`（與 Dashboard.astro 同路徑慣例）。
- Produces:
  - `export function publishHourHistogram(articles: Article[]): { hour: number; count: number }[]` — 回傳 24 筆（hour 0–23，count ≥ 0），依 hour 升冪。
  - `export function publishWeekdayHistogram(articles: Article[]): { weekday: string; count: number }[]` — 依「一 二 三 四 五 六 日」順序，count 可為 0。**星期以臺北牆鐘（UTC+08:00）為準**：由 `publishedAt` 前 10 字元日期（`YYYY-MM-DD`）推導，不用 `new Date().getDay()` 的環境時區。日期 → 星期的對映用固定表（見下方 `taipeiWeekday`），並以「2026-08-02（日）→ 日」等固定案例鎖定。
  - `export function viewsDistribution(articles: Article[]): ViewsDistribution`
    - `type ViewsDistribution = { total: number; max: number; p50: number; p90: number; p99: number; top10PctShare: number; buckets: { label: string; count: number }[] }`
    - `buckets`：依 views 對數分桶，label 為 `1–9`、`10–99`、`100–999`、`1000–9999`、`10000+`，各桶 count；桶順序固定如上。
    - `top10PctShare`：觀看最高的 top 10% 文章（`Math.ceil(n * 0.1)` 篇）佔總觀看比例（0–1，無文章時 0）。
    - 百分位：`p50/p90/p99` 為排序後 `Math.floor(idx * n)` 索引值（無文章時 0）。
  - `export function topSeriesBySubscriptions(series: Series[], n = 10): { name: string; subscriptions: number; dayCount: number; views: number }[]` — 依 subscriptions desc，同值依 name asc；回傳前 n；views = 該系列文章 views 總和。

**測試要點（實作前先寫）：**

- `publishHourHistogram`：空 articles → 24 筆 count 0；單篇文章 hour 1 → hour 1 count 1、其餘 0；多篇跨小時計數正確；hour 範圍 0–23 恆定。
- `publishWeekdayHistogram`：用固定 publishedAt 日期（`2026-08-01T..+08:00` 週六、`2026-08-03T..+08:00` 週一）驗證 weekday 映射（用固定 `taipeiWeekday` 表，非環境 getDay）；**跨日邊界**：`2026-08-02T23:30:00+08:00` → 日、`2026-08-03T00:30:00+08:00` → 一（臺北牆鐘，非 runtime timezone，review #2）；順序固定；空陣列 → 7 筆 0。
- `viewsDistribution`：`[10,20,30]` → p50=20、p90=30、p99=30、top10PctShare = ceil(3*0.1)=1 篇最高 30/60=0.5；空陣列 → total 0、buckets 全 0；`[7,103,8678]` → buckets `1–9`=1、`100–999`=1、`1000–9999`=1；max 正確。
- `topSeriesBySubscriptions`：依 subscriptions desc；同值 name asc；views = articles views 總和；n 預設 10、超過系列數回傳全部；空 series → `[]`。

- [ ] **Step 1: 寫 failing tests**

Create `web/src/lib/insights.test.ts`:

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && bun test src/lib/insights.test.ts`
Expected: FAIL — `Cannot find module './insights'`。

- [ ] **Step 3: 寫 minimal implementation**

Create `web/src/lib/insights.ts`:

```ts
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web && bun test src/lib/insights.test.ts`
Expected: PASS — 全部 tests green。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/insights.ts web/src/lib/insights.test.ts
git commit -m "feat(insights): add publish/views/subscription computation layer"
```

---

### Task 2: 計算層 — 組別 + 文字分析（TDD）

**Files:**
- Modify: `web/src/lib/insights.ts`
- Test: `web/src/lib/insights.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `import type { Series }`；新增 `lib/keywords.ts`（Task 本身上午完成）。
- Produces:
  - `export function groupStats(series: Series[]): { group: string; seriesCount: number; articleCount: number; avgViews: number; totalSubscriptions: number }[]` — 依 seriesCount desc，同值依 group localeCompare("zh-Hant") asc；`avgViews` = 該組文章 views 總和 / 該組文章數（無文章時 0，round 到整數）；`totalSubscriptions` = subscriptions 總和。
  - `export function titleKeywordStats(series: Series[], keywords: string[] = DEFAULT_KEYWORDS): { keyword: string; count: number }[]` — 見 Global Constraints 文字分析規則；**英文/數字關鍵詞只在 token 邊界命中**（`/[A-Za-z0-9]+/` 切 token 後比對，`AI` 不命中 `SAIL`），**中文關鍵詞**用大小寫正規化後的字典子字串比對；每系列標題對同關鍵字最多計 1；依 count desc，同 count 依 keyword localeCompare("zh-Hant") asc。
  - `export const DEFAULT_KEYWORDS: string[]` — 定義於 `lib/keywords.ts`，內容為 v1 字典（見下）。

**`lib/keywords.ts`（Task 2 新增）：**

```ts
// web/src/lib/keywords.ts — v1 中文/英文關鍵詞字典（人工列舉，非完整分詞）。
// spec §3.3：文字分析只分析 Series.title，每系列標題對同關鍵字最多計 1。
// 英文關鍵詞在 token 邊界命中（/^[A-Za-z0-9]+$/ → 以 token 集合比對，AI 不命中 SAIL）；
// 中文關鍵詞以子字串比對（不執行期切詞）。
export const DEFAULT_KEYWORDS: string[] = [
  "AI", "機器學習", "K8s", "Kubernetes", "安全", "雲端", "前端", "後端",
  "資料", "開發", "部署", "測試", "開源", "效能", "設計", "自動化",
  "Vibe", "SideProject", "Claude", "ChatGPT", "Compiler",
];
```

**測試要點：**

- `groupStats`：多組聚合（seriesCount、articleCount、avgViews 整數 round、totalSubscriptions）；avgViews 無文章組 = 0；排序 seriesCount desc + group asc；空 series → `[]`。
- `titleKeywordStats`：字典命中；**每系列標題最多計 1**（同一標題含同關鍵字 2 次只算 1）；大小寫正規化（`ai` 命中 `AI`）；只分析 `Series.title`（description 含關鍵字不計）；排序 count desc + keyword asc；空 series → `[]`。

- [ ] **Step 1: 寫 failing tests**

Append to `web/src/lib/insights.test.ts`（更新 import 加入 `groupStats, titleKeywordStats, DEFAULT_KEYWORDS`）:

```ts
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
    expect(stats.map((x) => x.keyword)).toEqual(["AI", "前端"]); // 各 1，依 asc
  });
  test("空 series → []", () => {
    expect(titleKeywordStats([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && bun test src/lib/insights.test.ts`
Expected: FAIL — `groupStats is not defined`。

- [ ] **Step 3: 寫 implementation**

Create `web/src/lib/keywords.ts`（見上方 Interfaces 的完整內容）。

Append to `web/src/lib/insights.ts`:

```ts
import { DEFAULT_KEYWORDS } from "./keywords"; // Task 2 新增

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

function isAsciiKeyword(k: string): boolean {
  return /^[A-Za-z0-9]+$/.test(k);
}

export function titleKeywordStats(
  series: Series[],
  keywords: string[] = DEFAULT_KEYWORDS,
): { keyword: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const k of keywords) counts.set(k, 0);
  for (const s of series) {
    const title = s.title.toLowerCase();
    for (const k of keywords) {
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web && bun test src/lib/insights.test.ts`
Expected: PASS — 全部 tests green。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/keywords.ts web/src/lib/insights.ts web/src/lib/insights.test.ts
git commit -m "feat(insights): add groupStats and titleKeywordStats (dictionary-based)"
```

---

### Task 3: `lib/charts.ts` — SVG 產生（TDD）

**Files:**
- Create: `web/src/lib/charts.ts`
- Test: `web/src/lib/charts.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的統計輸出型別（`ViewsDistribution`、`{hour,count}[]`、`{group,...}[]` 等）。
- Produces（每個回傳完整 `<svg>…</svg>` 字串，含 `viewBox`）:
  - `export function xmlEscape(s: string): string` — 依序替換 `&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`、`"`→`&quot;`、`'`→`&apos;`。
  - `export function barChartSVG(data: { label: string; value: number }[], opts?: { color?: string; height?: number; width?: number; formatValue?: (v: number) => string }): string` — 垂直長條圖；每 bar 有 `<rect>`（`fill` = color 或 `var(--accent)`）+ `<title>{label}: {value}</title>` + `<aria-label>`；x 軸下方 label（`<text>`，XML escaped）。
  - `export function horizontalBarSVG(data: { label: string; value: number }[], opts?: { color?: string; height?: number; width?: number; formatValue?: (v: number) => string }): string` — 水平長條圖（訂閱龍頭用）。
  - `export function distributionBarSVG(buckets: { label: string; count: number }[], opts?: { color?: string; height?: number; width?: number }): string` — 分桶長條圖（spec §4.3：不建立泛用 LineChart）。
  - `export function scatterSVG(points: { x: number; y: number; label: string; tooltip: string }[], opts?: BarOpts & { xLabel?: string; xMax?: number; yMax?: number }): string` — 散點圖（組別分析），每 point 有 `<circle>` + `<title>{tooltip}</title>`。

**測試要點（TDD）：**

- `xmlEscape`：`& < > " '` 全替換；無特殊字元原樣。
- `barChartSVG`：回傳以 `<svg` 開頭、`</svg>` 結尾；含與 data 等量的 `<rect`；每 bar 有 `<title>` 且含 label + value；label 有 XML escaping（`<` 不直接出現）。
- `distributionBarSVG`：回傳含 `</svg>`；buckets 數量的 `<rect`。
- `scatterSVG`：points 數量的 `<circle`；每 point `<title>` 含 tooltip。

- [ ] **Step 1: 寫 failing tests**

Create `web/src/lib/charts.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { xmlEscape, barChartSVG, horizontalBarSVG, distributionBarSVG, scatterSVG } from "./charts";

describe("xmlEscape", () => {
  test("五個特殊字元全替換", () => {
    expect(xmlEscape(`<a & "b" 'c'>`)).toBe(`&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;`);
  });
  test("無特殊字元原樣", () => {
    expect(xmlEscape("普通文字 123")).toBe("普通文字 123");
  });
});

describe("barChartSVG", () => {
  const svg = barChartSVG([{ label: "00 時", value: 5 }, { label: "01 時", value: 3 }]);
  test("SVG 外殼", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
  test("每 bar 有 rect", () => {
    expect(svg.match(/<rect/g)).toHaveLength(2);
  });
  test("每 bar 有 title 含 label + value", () => {
    expect(svg).toContain("<title>00 時: 5</title>");
    expect(svg).toContain("<title>01 時: 3</title>");
  });
  test("label XML escaping（< 不直接出現）", () => {
    const s = barChartSVG([{ label: "a<b", value: 1 }]);
    expect(s).toContain("a&lt;b");
    expect(s).not.toContain("a<b");
  });
});

describe("horizontalBarSVG", () => {
  test("SVG 外殼 + rect 數量", () => {
    const svg = horizontalBarSVG([{ label: "A", value: 33 }, { label: "B", value: 20 }]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<rect/g)).toHaveLength(2);
  });
});

describe("distributionBarSVG", () => {
  test("buckets 數量的 rect", () => {
    const svg = distributionBarSVG([
      { label: "1–9", count: 3 }, { label: "10–99", count: 0 }, { label: "100–999", count: 1 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<rect/g)).toHaveLength(3);
  });
  test("count 0 仍輸出 rect（高度 0）", () => {
    const svg = distributionBarSVG([{ label: "1–9", count: 0 }]);
    expect(svg.match(/<rect/g)).toHaveLength(1);
  });
});

describe("scatterSVG", () => {
  test("points 數量的 circle + title", () => {
    const svg = scatterSVG([
      { x: 1, y: 2, label: "Web", tooltip: "Web: 5 系列" },
      { x: 3, y: 4, label: "AI", tooltip: "AI: 3 系列" },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg).toContain("<title>Web: 5 系列</title>");
    expect(svg).toContain("<title>AI: 3 系列</title>");
  });
  test("每個 circle 只有一個 <title>（review #6）", () => {
    const svg = scatterSVG([{ x: 1, y: 2, label: "Web", tooltip: "Web: 5 系列" }]);
    expect(svg.match(/<title>/g)).toHaveLength(1);
  });
});

describe("XML escaping 完整性（review #7）", () => {
  test("attribute context：label 含 quote 不逃逸出 attribute", () => {
    const label = `" onclick="alert(1)`;
    const svg = barChartSVG([{ label, value: 1 }]);
    // attribute 內不得出現未 escaped quote —— 否則可注入新 attribute
    expect(svg).not.toContain(`aria-label="${label}`);
    expect(svg).toContain("&quot;");
    // 產生的 SVG 不含可執行的 onclick
    expect(svg).not.toContain("onclick");
  });
  test("title context：tooltip 含 & < > \" ' 全 escaping", () => {
    const svg = scatterSVG([{ x: 1, y: 2, label: "L", tooltip: `& < > " '` }]);
    expect(svg).toContain("<title>&amp; &lt; &gt; &quot; &apos;</title>");
    expect(svg).not.toContain("<title>& < >");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && bun test src/lib/charts.test.ts`
Expected: FAIL — `Cannot find module './charts'`。

- [ ] **Step 3: 寫 implementation**

Create `web/src/lib/charts.ts`:

```ts
// web/src/lib/charts.ts — 唯一 SVG 產生來源（SSG 與 client 共用）。
// spec §4.3：外部資料（label/tooltip）必須 XML escaping；不建立泛用 LineChart。
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type BarOpts = { color?: string; height?: number; width?: number; formatValue?: (v: number) => string };
const DEFAULTS = { color: "var(--accent)", height: 180, width: 320 };

function barTitle(label: string, value: number, fmt?: (v: number) => string): string {
  return `<title>${xmlEscape(label)}: ${xmlEscape(fmt ? fmt(value) : String(value))}</title>`;
}

export function barChartSVG(data: { label: string; value: number }[], opts: BarOpts = {}): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 4;
  const bw = (width - gap * (data.length - 1)) / Math.max(data.length, 1);
  const bars = data
    .map((d, i) => {
      const h = (d.value / max) * (height - 20);
      const x = i * (bw + gap);
      const y = height - h;
      const label = `<text x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(d.label)}</text>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" aria-label="${xmlEscape(d.label)}: ${d.value}">${barTitle(d.label, d.value, opts.formatValue)}</rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

export function horizontalBarSVG(data: { label: string; value: number }[], opts: BarOpts = {}): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = 20;
  const rows = data
    .map((d, i) => {
      const w = (d.value / max) * (width - 70);
      const y = i * rowH;
      const label = `<text x="0" y="${y + 13}" font-size="10" fill="var(--text)">${xmlEscape(d.label)}</text>`;
      const rect = `<rect x="65" y="${y + 3}" width="${w.toFixed(1)}" height="${rowH - 8}" fill="${color}" aria-label="${xmlEscape(d.label)}: ${d.value}">${barTitle(d.label, d.value, opts.formatValue)}</rect>`;
      const val = `<text x="${(65 + w + 4).toFixed(1)}" y="${y + 13}" font-size="9" fill="var(--muted)">${xmlEscape(opts.formatValue ? opts.formatValue(d.value) : String(d.value))}</text>`;
      return label + rect + val;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`;
}

export function distributionBarSVG(buckets: { label: string; count: number }[], opts: BarOpts = {}): string {
  // spec §4.3：分桶分佈用長條圖；count 0 仍輸出 rect（高度 0）。
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const gap = 6;
  const bw = (width - gap * (buckets.length - 1)) / Math.max(buckets.length, 1);
  const bars = buckets
    .map((b, i) => {
      const h = (b.count / max) * (height - 24);
      const x = i * (bw + gap);
      const y = height - h;
      const label = `<text x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(b.label)}</text>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" aria-label="${xmlEscape(b.label)}: ${b.count}">${barTitle(b.label, b.count)}</rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

export function scatterSVG(
  points: { x: number; y: number; label: string; tooltip: string }[],
  opts: BarOpts & { xLabel?: string; xMax?: number; yMax?: number } = {},
): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const xMax = opts.xMax ?? Math.max(...points.map((p) => p.x), 1);
  const yMax = opts.yMax ?? Math.max(...points.map((p) => p.y), 1);
  const padL = 30, padB = 20, padT = 8;
  const plotW = width - padL;
  const plotH = height - padT - padB;
  const circles = points
    .map((p) => {
      const cx = padL + (p.x / xMax) * plotW;
      const cy = padT + plotH - (p.y / yMax) * plotH;
      // 單一 <title>（完整 tooltip）；aria-label 帶 label（review #6）
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${color}" aria-label="${xmlEscape(p.label)}"><title>${xmlEscape(p.tooltip)}</title></circle>`;
    })
    .join("");
  const xLabel = `<text x="${padL + plotW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(opts.xLabel ?? "")}</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${circles}${xLabel}</svg>`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web && bun test src/lib/charts.test.ts`
Expected: PASS — 全部 tests green。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/charts.ts web/src/lib/charts.test.ts
git commit -m "feat(insights): add XML-escaped SVG chart renderers"
```

---

### Task 4: History snapshot 寫入（scrape.ts，TDD）

**Files:**
- Modify: `scripts/scrape.ts`（CLI 流程，`stageWrites` 之前）
- Test: `scripts/scrape.test.ts`（擴充）

**Interfaces:**
- Consumes: `taipeiTimestamp(d: Date)`（既有）；`collectYears` 回傳的 `succeeded: YearData[]`。
- Produces: `export function historyDate(updatedAt: string): string` — 取 `updatedAt` 的臺北日期 `YYYY-MM-DD`（`slice(0,10)`；`updatedAt` 格式為 `"2026-08-06 15:13:18+08:00"`）；`export async function writeHistorySnapshots(dataDir: string, years: YearData[]): Promise<string[]>` — 對每個 year **individually attempt** 寫 `data/history/{year}/{historyDate(updatedAt)}.json`（同結構 JSON），檔案已存在且內容相同（字串比對）跳過，否則 `mkdir -p` + 寫入；**單一年度失敗記錄該年度錯誤並繼續其他年度**，函式最後回傳失敗清單 `string[]`（review #3）。

**測試要點（TDD，mock fs）：**

- `historyDate`：`"2026-08-06 00:30:00+08:00"` → `"2026-08-06"`；`"2026-08-05 23:30:00+08:00"` → `"2026-08-05"`（臺北日期，非 UTC，spec §5.2）。
- `writeHistorySnapshots`：用 temp dir + `readFile` 驗證「檔案寫入且內容 = YearData」；已存在相同內容 → 不覆寫（mtime 不變或內容比對）；已存在不同內容 → 覆寫；不同 year 寫不同子目錄。

**實作方式（在 `scripts/scrape.ts` CLI 段，`collectYears` 之後）：**

```ts
export function historyDate(updatedAt: string): string {
  return updatedAt.slice(0, 10); // 臺北日期 = updatedAt 前 10 字元（+08:00 牆鐘）
}

export async function writeHistorySnapshots(dataDir: string, years: YearData[]): Promise<string[]> {
  const failures: string[] = [];
  for (const data of years) {
    try {
      const dir = join(dataDir, "history", String(data.year));
      const path = join(dir, `${historyDate(data.updatedAt)}.json`);
      await mkdir(dir, { recursive: true });
      const content = JSON.stringify(data, null, 2);
      try {
        const existing = await readFile(path, "utf-8");
        if (existing === content) continue; // 相同內容跳過（無變更不 commit）
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await writeFile(path, content);
    } catch (e) {
      // 單一年度失敗：記錄並繼續其他年度（review #3）
      failures.push(`${data.year}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failures;
}
```

CLI 插入點（`collectYears` 成功後、`stageWrites` 前）:

```ts
  // History snapshots: independent of the atomic main-file commit (spec §5.2).
  // Per-year failures are collected and logged; they never block the main
  // {year}.json write (review #3).
  try {
    const failures = await writeHistorySnapshots(dataDir, succeeded);
    for (const f of failures) console.error(`history snapshot failed: ${f}`);
  } catch (e) {
    // writeHistorySnapshots 本身不 throw（單年度失敗已內收），此 catch 為防護
    console.error(`history snapshot error: ${e instanceof Error ? e.message : String(e)}`);
  }
```

- [ ] **Step 1: 寫 failing tests**

Append to `scripts/scrape.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyDate, writeHistorySnapshots } from "./scrape";
import type { YearData } from "./types";

describe("historyDate", () => {
  test("臺北日期（非 UTC）", () => {
    expect(historyDate("2026-08-06 00:30:00+08:00")).toBe("2026-08-06");
    expect(historyDate("2026-08-05 23:30:00+08:00")).toBe("2026-08-05");
  });
});

describe("writeHistorySnapshots", () => {
  function yearData(over: Partial<YearData> = {}): YearData {
    return {
      year: 2026, updatedAt: "2026-08-06 15:13:18+08:00",
      groups: [], series: [], scrapeLog: [], ...over,
    };
  }

  test("寫入 data/history/{year}/{date}.json 且內容相同", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      const data = yearData({ year: 2026 });
      await writeHistorySnapshots(dir, [data]);
      const content = await readFile(join(dir, "history", "2026", "2026-08-06.json"), "utf-8");
      expect(JSON.parse(content)).toEqual(data);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("已存在相同內容 → 不覆寫（mtime 不變）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      const data = yearData({ year: 2026 });
      const path = join(dir, "history", "2026", "2026-08-06.json");
      await writeHistorySnapshots(dir, [data]);
      const mtime1 = (await import("node:fs")).statSync(path).mtimeMs;
      await new Promise((r) => setTimeout(r, 20));
      await writeHistorySnapshots(dir, [data]);
      const mtime2 = (await import("node:fs")).statSync(path).mtimeMs;
      expect(mtime2).toBe(mtime1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("已存在不同內容 → 覆寫", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      const old = yearData({ year: 2026, series: [] });
      const fresh = yearData({ year: 2026, groups: ["Web"], series: [] });
      const path = join(dir, "history", "2026", "2026-08-06.json");
      await writeHistorySnapshots(dir, [old]);
      await writeHistorySnapshots(dir, [fresh]);
      expect(JSON.parse(await readFile(path, "utf-8"))).toEqual(fresh);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("不同 year 寫不同子目錄", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      await writeHistorySnapshots(dir, [yearData({ year: 2025 }), yearData({ year: 2026 })]);
      expect(JSON.parse(await readFile(join(dir, "history", "2025", "2026-08-06.json"), "utf-8")).year).toBe(2025);
      expect(JSON.parse(await readFile(join(dir, "history", "2026", "2026-08-06.json"), "utf-8")).year).toBe(2026);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("第一年度失敗仍寫入第二年度（review #3）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hist-"));
    try {
      // 讓 2026 的 history 目錄位置被一個普通檔案佔住 → mkdir 失敗
      await writeFile(join(dir, "history", "2026"), "blocking file", { recursive: true });
      const failures = await writeHistorySnapshots(dir, [
        yearData({ year: 2026 }),
        yearData({ year: 2025 }),
      ]);
      // 2026 失敗、2025 成功
      expect(failures.length).toBe(1);
      expect(failures[0]).toContain("2026");
      expect(JSON.parse(await readFile(join(dir, "history", "2025", "2026-08-06.json"), "utf-8")).year).toBe(2025);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd scripts && bun test scrape.test.ts`
Expected: FAIL — `historyDate is not defined` 或 `writeHistorySnapshots is not defined`。

- [ ] **Step 3: 寫 implementation**

在 `scripts/scrape.ts` 加 `historyDate` + `writeHistorySnapshots`（見上方 Interfaces），並在 CLI 插入點加 try/catch 呼叫。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd scripts && bun test scrape.test.ts`
Expected: PASS — 既有 tests + 新 tests 全綠（`mergeCardsAndStats`、`taipeiTimestamp` 不 regression）。

- [ ] **Step 5: Commit**

```bash
git add scripts/scrape.ts scripts/scrape.test.ts
git commit -m "feat(scrape): write daily history snapshots (data/history/{year}/{date}.json)"
```

---

### Task 5: `Insights.astro` 元件（SSG 版面 + SVG 面板）

**Files:**
- Create: `web/src/components/Insights.astro`
- Create: `web/src/styles/insights.css`

**Interfaces:**
- Consumes: Task 1–3 的 `lib/insights.ts`（`publishHourHistogram`、`publishWeekdayHistogram`、`viewsDistribution`、`topSeriesBySubscriptions`、`groupStats`、`titleKeywordStats`）、`lib/charts.ts`（`barChartSVG`、`horizontalBarSVG`、`distributionBarSVG`、`scatterSVG`）、`lib/keywords.ts`（`DEFAULT_KEYWORDS`）、`type YearData`。
- Produces: `Insights.astro` 接受 `data: YearData`、`years: number[]`、`latestYear: number`、`hasData: boolean` props（`hasData = data.series.length > 0`，review #4），輸出四個面板 + header（年切換器 + 主題 toggle）。四個面板的 SVG 與洞察句在 SSG 時由 frontmatter 算好，render 進 HTML；同時把「資料 + 各函式」以 `define:vars` 注入，供 Task 6 的 client 重繪使用。`hasData === false` 時四個面板顯示「尚無資料」、年切換器不列出任何年度。

**四個面板（spec §4.2）：** 若 `data.year === 0` 或 `data.series.length === 0`（空資料），所有面板顯示「尚無資料」、圖表容器留空（review #4）。

1. **發文行為**：`barChartSVG(publishHourHistogram(articles))`（24 小時）+ `barChartSVG(publishWeekdayHistogram(articles))`（**星期分佈**，一…日，review #9）。洞察句：找到 count 最高的 hour → 「00 時為發文高峰（N 篇）」；無文章 → 「尚無發文資料」。
2. **人氣結構**：`distributionBarSVG(viewsDistribution(articles).buckets)`（分桶長條圖）+ `horizontalBarSVG(topSeriesBySubscriptions(series))`（訂閱龍頭 top 10）。洞察句：`top10PctShare` → 「前 10% 文章佔總觀看 X%」；無文章 → 「尚無觀看資料」。
3. **組別分析**：`scatterSVG(groupStats(series).map(g => ({x: g.articleCount, y: g.avgViews, label: g.group, tooltip: `${g.group}: ${g.seriesCount} 系列 / ${g.articleCount} 文 / 平均 ${g.avgViews} 觀看`})))`。洞察句：seriesCount 最高的組 → 「{group} 最活躍（N 系列）」。
4. **文字分析**：`barChartSVG(titleKeywordStats(series))`（關鍵字）。洞察句：count 最高的 keyword → 「N 個系列標題包含「{keyword}」」；全部 0 → 「尚無標題關鍵字」。

**SSG 注入（供 Task 6 client 重繪）**:

```astro
<script is:inline define:vars={{ initialData: data, yearsList: years }}>
  window.INSIGHTS_DATA = initialData;
  window.INSIGHTS_YEARS = yearsList;
</script>
```

> 註：`data.year === 0`（空資料）時 `yearsList` 為空、`initialData` 為 emptyData；client script 依 `data.year === 0` 分支顯示空狀態（review #4）。

**洞察句 HTML 結構（每個面板）**:

```html
<section class="insight-panel">
  <h2 class="insight-title">發文行為</h2>
  <p class="insight-line" id="insight-hour-line">00 時為發文高峰（45 篇）</p>
  <div class="insight-charts">
    <div class="insight-chart" id="chart-hour">{hourSVG}</div>
    <div class="insight-chart" id="chart-weekday">{weekdaySVG}</div>
  </div>
</section>
```

（`{hourSVG}` 等為 frontmatter 用 `barChartSVG` 算出的字串，以 `set:html` 或直接插值——Astro 對 `set:html` 的字串會原樣輸出，屬**受信任本地產生** markup，已 XML escaping。）

**insights.css**（沿用 design-system tokens；`@import` 於 `insights.astro` 的 `<style is:global>`）:

```css
/* web/src/styles/insights.css — Insights 分頁樣式（沿用 design-system.css tokens） */
.insight-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  margin-block-end: var(--space-5);
}
.insight-title {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0;
}
.insight-line { font-size: var(--text-sm); color: var(--text); margin-block: var(--space-2); }
.insight-charts { display: flex; flex-wrap: wrap; gap: var(--space-5); }
.insight-chart { flex: 1 1 320px; min-width: 0; }
```

- [ ] **Step 1: 建立 `web/src/components/Insights.astro`**

依上述 Interfaces 與面板結構實作；frontmatter 用 `import.meta.glob` 讀資料的方式留給 Task 6 的 page（本元件只吃 props）。SVG 字串用 `set:html` 輸出（受信任本地產生，已 escaping）。

- [ ] **Step 2: 建立 `web/src/styles/insights.css`**

依上方內容寫入；在 `Insights.astro` 的 `<style is:global>` `@import "../styles/insights.css"`。

- [ ] **Step 3: 驗證元件可被 page 引用（Task 6 前暫不建 page）**

先以 astro check 驗證型別：

Run: `cd web && bunx astro check`
Expected: 無新增 error（若 page 尚未存在，Insights.astro 的 props 型別由 astro check 獨立驗證）。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Insights.astro web/src/styles/insights.css
git commit -m "feat(insights): add Insights.astro component with SSG SVG panels"
```

> 註：本 Task 的元件尚未被任何 page 引用，`astro check` 仍可驗證其型別正確性；實際視覺驗證在 Task 7。

---

### Task 6: `pages/insights.astro` + client-side 年切換

**Files:**
- Create: `web/src/pages/insights.astro`
- Modify: `web/src/components/Dashboard.astro`（header 加「Insights」連結）
- Modify: `web/src/styles/design-system.css`（Insights 連結樣式，若有需要）

**Interfaces:**
- Consumes: `Insights.astro`（props: `data`、`years`、`latestYear`）；`lib/insights.ts` + `lib/charts.ts`（client 重繪）；`lib/keywords.ts`。
- Produces: `/insights/` 路由 + header 連結 + client 年切換邏輯。

**page frontmatter**（沿用 `index.astro` 的 glob pattern；**含空資料 fallback**，review #4）:

```astro
---
import Insights from "../components/Insights.astro";
import type { MetaJson, YearData } from "../../../scripts/types";
const dataByYear = new Map<number, YearData>();
for (const [path, mod] of Object.entries(import.meta.glob("../../../data/*.json", { eager: true, import: "default" }))) {
  const m = path.match(/(\d{4})\.json$/);
  if (m) dataByYear.set(Number(m[1]), mod as YearData);
}
const meta = (await import("../../../data/meta.json").then((m) => m.default)) as MetaJson;
const years = meta.years.filter((y) => dataByYear.has(y)).sort((a, b) => b - a);
const latestYear = years[0] ?? [...dataByYear.keys()].sort((a, b) => b - a)[0];
// 空資料 fallback：完全沒有可用 YearData 時不 crash，顯示空狀態面板（spec §6、review #4）
const emptyData: YearData = { year: 0, updatedAt: "", groups: [], series: [], scrapeLog: [] };
const data: YearData = latestYear !== undefined && dataByYear.has(latestYear) ? dataByYear.get(latestYear)! : emptyData;
const hasData = data.series.length > 0;
---
```

> 註：`data.year === 0` 代表無資料（`meta.years` 空且無 `data/*.json` 年度檔）；`Insights.astro` 與 client script 需處理 `hasData === false`（見下方）。

**theme + insights.css + Insights 元件**（head 與 body，模仿 index.astro 的 theme inline script）。`<Insights data={data} years={years} latestYear={latestYear} hasData={hasData} />`（`hasData` 供元件空狀態分支，review #4）。

**client 年切換 script**（`<script>` 內，沿用 Dashboard 的 fetchToken 模式；`window` property 的 `any` 限縮於此兩處，review #8）:

```ts
import { publishHourHistogram, publishWeekdayHistogram, viewsDistribution, topSeriesBySubscriptions, groupStats, titleKeywordStats } from "../lib/insights";
import { barChartSVG, horizontalBarSVG, distributionBarSVG, scatterSVG } from "../lib/charts";
import { DEFAULT_KEYWORDS } from "../lib/keywords";

// Astro define:vars 注入的非標準 window property——僅此兩處允許 (window as any)（review #8）
const initialData = (window as any).INSIGHTS_DATA as YearData;
const yearsList = (window as any).INSIGHTS_YEARS as number[];
let fetchToken = 0;
let current: YearData = initialData;

function insights(year: number) {
  const token = ++fetchToken;
  fetch(`/data/${year}.json?t=${Date.now()}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((fresh) => {
      if (!fresh || token !== fetchToken) return;
      current = fresh;
      render(fresh);
      history.replaceState(null, "", `?year=${fresh.year}`);
    })
    .catch(() => { /* keep current render */ });
}

function allArticles(d: YearData) { return d.series.flatMap((s) => s.articles); }

function render(d: YearData) {
  // 空資料（data.year === 0）：全部面板顯示空狀態，不重繪（review #4）
  if (d.year === 0 || d.series.length === 0) {
    renderEmpty();
    return;
  }
  const arts = allArticles(d);
  // 1. 發文行為
  const hour = publishHourHistogram(arts);
  const weekday = publishWeekdayHistogram(arts);
  const peakHour = hour.reduce((a, b) => (b.count > a.count ? b : a), hour[0]);
  setText("insight-hour-line", arts.length === 0 ? "尚無發文資料" : `${String(peakHour.hour).padStart(2, "0")} 時為發文高峰（${peakHour.count} 篇）`);
  setSvg("chart-hour", barChartSVG(hour.map((h) => ({ label: `${String(h.hour).padStart(2, "0")} 時`, value: h.count }))));
  setSvg("chart-weekday", barChartSVG(weekday.map((w) => ({ label: `${w.weekday}`, value: w.count }))));
  // 2. 人氣結構
  const dist = viewsDistribution(arts);
  setText("insight-dist-line", arts.length === 0 ? "尚無觀看資料" : `前 10% 文章佔總觀看 ${Math.round(dist.top10PctShare * 100)}%`);
  setSvg("chart-dist", distributionBarSVG(dist.buckets));
  setSvg("chart-subs", horizontalBarSVG(topSeriesBySubscriptions(d.series).map((s) => ({ label: s.name, value: s.subscriptions }))));
  // 3. 組別分析
  const groups = groupStats(d.series);
  setSvg("chart-scatter", scatterSVG(groups.map((g) => ({ x: g.articleCount, y: g.avgViews, label: g.group, tooltip: `${g.group}: ${g.seriesCount} 系列 / ${g.articleCount} 文 / 平均 ${g.avgViews} 觀看` }))));
  const topGroup = groups[0];
  setText("insight-group-line", groups.length === 0 ? "尚無組別資料" : `${topGroup.group} 最活躍（${topGroup.seriesCount} 系列）`);
  // 4. 文字分析
  const kws = titleKeywordStats(d.series, DEFAULT_KEYWORDS);
  setSvg("chart-kw", barChartSVG(kws.map((k) => ({ label: k.keyword, value: k.count }))));
  const topKw = kws[0];
  setText("insight-kw-line", kws.length === 0 ? "尚無標題關鍵字" : `${topKw.count} 個系列標題包含「${topKw.keyword}」`);
  // 年切換器同步
  const sel = document.getElementById("insight-year-select") as HTMLSelectElement | null;
  if (sel) sel.value = String(d.year);
}

function renderEmpty() {
  // 空資料狀態：所有面板「尚無資料」，年切換器清空（review #4）
  for (const id of ["insight-hour-line", "insight-dist-line", "insight-group-line", "insight-kw-line"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = "尚無資料";
  }
  for (const id of ["chart-hour", "chart-weekday", "chart-dist", "chart-subs", "chart-scatter", "chart-kw"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  }
}

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text; // 文字洞察句一律 textContent（review #8）
}
function setSvg(id: string, svg: string) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = svg; // 唯一 innerHTML sink：charts.ts 回傳的完整 SVG（已 XML escaping）（review #8）
}

// init: 讀 ?year= 還原（無效 fallback latestYear；無資料時不 fetch）
const q = new URLSearchParams(location.search).get("year");
const initYear = yearsList.includes(Number(q)) ? Number(q) : initialData.year;
if (initYear !== initialData.year && initYear !== 0) {
  insights(initYear); // 會 fetch 並 render + replaceState
} else {
  render(initialData);
  if (initialData.year !== 0) history.replaceState(null, "", `?year=${initialData.year}`);
}
document.getElementById("insight-year-select")?.addEventListener("change", (e) => {
  const y = Number((e.target as HTMLSelectElement).value);
  if (Number.isInteger(y) && y !== 0) insights(y);
});
```

**Dashboard.astro header 加連結**（header-actions 內，GitHub icon 前）:

```astro
<a class="icon-btn" href="/insights/" aria-label="Insights 分析" title="Insights 分析">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l4-5 3 3 5-7"/></svg>
</a>
```

- [ ] **Step 1: 建立 `web/src/pages/insights.astro`**

依上述 frontmatter + theme + Insights 元件 + client script 實作。

- [ ] **Step 2: Dashboard header 加 Insights 連結**

在 `Dashboard.astro` header-actions 內加連結（見上）。

- [ ] **Step 3: astro check 驗證型別**

Run: `cd web && bunx astro check`
Expected: 無 error（新增 page + 元件 + client script 型別正確）。

- [ ] **Step 4: build 驗證**

Run: `cd web && bun run build`
Expected: build 成功；`dist/insights/index.html` 存在；`dist/data/2026.json` 存在（copy-data 階段）。

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/insights.astro web/src/components/Dashboard.astro web/src/styles/design-system.css
git commit -m "feat(insights): add /insights/ page with client-side year switching"
```

---

### Task 7: 視覺驗證 + 互動驗證（headless browser）

**Files:**
- 無（驗證 Task，不改程式碼；若發現 bug 回到對應 Task 修）

**Interfaces:**
- Consumes: 前六 Task 的成果（`/insights/` 頁 + history 寫入）。

**驗證步驟：**

- [ ] **Step 1: 啟動 dev server**

用 hub 啟動（非 bash，避免長駐程序佔住 shell）：

```text
hub op=start name=insights-dev application=bun args=["run","dev"] cwd=web ready.log="Local.*http" ready.port=4321 ready.timeout=60
```

（若 port 不同，以 dev server 輸出為準。）

- [ ] **Step 2: headless browser 開 `/insights/`**

用 browser 工具 `open` `/insights/`（dev URL），`tab.observe()` 確認：
- 四個面板標題（發文行為 / 人氣結構 / 組別分析 / 文字分析）都出現。
- 每個面板有 SVG 圖表（`<svg>` 存在）+ 洞察句（非空）。
- 無 console error（`tab.evaluate(() => window.__errors)` 若無收集則略過）。

- [ ] **Step 3: 驗證年切換**

- 切換年 select（若有多年，2025→2026 或反之），確認：
  - URL 變 `?year=N`（`history.replaceState` 生效）。
  - 圖表重繪（SVG 內容改變或至少不 crash）。
  - 快速連續切換不殘留舊資料（fetchToken 生效——手動驗證無 stale 覆蓋）。
- 重新整理 `/insights/?year=N`：初始載入還原該年資料。

- [ ] **Step 4: 驗證 hover tooltip**

不依賴瀏覽器原生 tooltip「是否出現」（原生 `<title>` 顯示由瀏覽器控制，headless 難可靠驗證）；改驗證（review「驗證計畫評語」）:
- 每個 bar / point 有 `<title>`（`tab.evaluate` 數 `svg title` 數量 > 0）。
- `<title>` 內容包含 label + value（如 `"00 時: 5"`）。
- pointer hover 任一 bar / point 不造成 console error（`tab.evaluate` 觸發 `mouseover` 後檢查無例外）。

- [ ] **Step 5: 驗證 history 快照（寫入契約由 Task 4 unit test 驗證）**

- 本機若已跑過 scrape 或手動 `bun run scripts/scrape.ts`：確認 `data/history/2026/2026-08-06.json` 存在，`diff <(cat data/2026.json) <(cat data/history/2026/2026-08-06.json)` 為空（同日最後一次結構相同）。
- **若未執行 live scrape**：明確記錄「未做 live scrape，寫入契約由 Task 4 unit test 驗證」——不把 acceptance 視為通過（review「驗證計畫評語」）。

- [ ] **Step 6: 驗證無資料年度空狀態（經真實 copy/build 流程）**

空資料狀態的單元層級由 Task 6 的 `renderEmpty` + `emptyData` fallback 保證（review #4）；此步驗證**真實 build 流程**（review「驗證計畫評語」——不依賴手動 public 目錄狀態）：
- 暫時把 `data/*.json` 年度檔移開（`mv data/2026.json data/2026.json.bak`），`cd web && bun run build` → 確認 build 成功、`/insights/` 顯示「尚無資料」四面板、不 crash。
- 還原 `mv data/2026.json.bak data/2026.json`，重新 `bun run build` 確認恢復正常。

- [ ] **Step 7: 關 dev server + 回歸**

- `hub op=stop name=insights-dev`。
- Run: `cd web && bun test src/lib && cd ../scripts && bun test`
  Expected: 全部 tests green（insights/charts/search/favorites/daily-status + scrape）。

---

## Self-Review

**Spec coverage：**

| Spec 要求 | Task |
|---|---|
| §3.2 計算層六函式 | Task 1（hour/weekday/views/subs）、Task 2（group/keywords） |
| §3.3 文字分析（series.title only、字典、計 1、排序） | Task 2 |
| §4.1 `/insights/` 路由 + header 連結 + client 年切換 | Task 6 |
| §4.2 四面板 + 洞察句 | Task 5（元件）+ Task 6（page） |
| §4.3 charts.ts 唯一 SVG 來源 + XML escaping + 分桶長條圖 | Task 3 |
| §4.4 client 重繪 + fetchToken + replaceState | Task 6 |
| §5 history snapshot + 臺北日期 + 不綁 atomic | Task 4 |
| §6 空資料狀態 / 空陣列安全 | Task 5/6 |
| §7 測試 | Task 1–4 |
| §9 Acceptance 1–8 | Task 5–7 |

**Placeholder 掃描：** 無 TBD/TODO；所有 code step 含完整實作；測試 step 含完整 test code。

**Type consistency：**
- `publishHourHistogram` 回傳 `{hour,count}[]` → Task 5/6 用 `h.hour`、`h.count` ✓
- `viewsDistribution` 回傳 `{total,max,p50,p90,p99,top10PctShare,buckets}` → Task 5/6 用 `dist.top10PctShare`、`dist.buckets` ✓
- `groupStats` 回傳 `{group,seriesCount,articleCount,avgViews,totalSubscriptions}[]` → Task 5/6 用 `g.group/g.articleCount/g.avgViews/g.seriesCount` ✓
- `titleKeywordStats(series, DEFAULT_KEYWORDS)` → Task 5/6 一致 ✓
- `barChartSVG`/`horizontalBarSVG`/`distributionBarSVG`/`scatterSVG` 的 data shape 在 Task 5/6 對齊（`{label,value}[]`、`{label,count}[]`、`{x,y,label,tooltip}[]`）✓
- `window.INSIGHTS_DATA` / `INSIGHTS_YEARS`（Task 5 define:vars）→ Task 6 讀取 ✓
- `historyDate`/`writeHistorySnapshots`（Task 4）命名一致 ✓

**已解決矛盾 / review 修正：**
- scatterSVG opts 型別一致為 `BarOpts & { xLabel?: string; xMax?: number; yMax?: number }`（Interfaces + 實作同步，無 stale snippet，review #5）。
- `titleKeywordStats` 英文關鍵詞 token 邊界、中文子字串（review #1）。
- weekday 統計以臺北牆鐘為準，非 runtime timezone（review #2）。
- `writeHistorySnapshots` 回傳 failures、單年度失敗繼續（review #3）。
- page frontmatter 空資料 fallback（`emptyData`，review #4）。
- scatterSVG 每 point 單一 `<title>`（review #6）；XML escaping attribute/title context 測試補全（review #7）。
- innerHTML 例外縮到 charts.ts SVG、`(window as any)` 限兩處（review #8）；「星期分佈」統一文案（review #9）。

---

## Execution Handoff

Plan 完成並存於 `docs/superpowers/plans/2026-08-06-ironman-observer-insights.md`。兩種執行方式：

**1. Subagent-Driven（推薦）** — 每個 task 派一個 fresh subagent，task 間兩階段 review，快速迭代

**2. Inline Execution** — 本 session 用 executing-plans 逐 task 執行，批次 checkpoint 供 review

**選哪個？**
