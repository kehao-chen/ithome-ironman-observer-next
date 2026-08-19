# 名人堂（Hall of Fame）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/hall-of-fame/` 獨立頁面，表列少數具公眾知名度的 2026 鐵人賽作者（初始 3-5 位，高見龍必含），附一句話介紹、可驗證來源連結、與該名人在目前年度的系列文章。

**Architecture:** 前端 JSON 名單（`web/src/data/famous-authors.json`，key = ithelp `user.id`）+ `hall-of-fame.ts` 純函式 join（`matchFamousAuthors` 以 `entry.id === series.user.id`）。系列卡採**雙層 renderer 契約**：SSR 用 `HallOfFameSeriesCard.astro`（Astro markup，Node context 可執行），client 用 `buildReadOnlyCard`（`hall-of-fame-dom.ts`，DOM builder）——兩層皆由 `cardViewModel`（`card.ts`）驅動，結構以測試鎖定對齊；read-only（無收藏/RSS 按鈕，名人堂無 Dashboard 的 fav/RSS infrastructure）。scraper / `data/` shape 零變動。

**Tech Stack:** Astro 5（SSG）、TypeScript、Bun test + happy-dom（DOM 契約測試）、`design-system.css` tokens。

## Global Constraints

- 所有使用者/名人資料一律 `textContent` 渲染，**禁 `innerHTML`**（XSS 契約）。
- 外連 URL 一律過 `safeHref`（`hall-of-fame.ts`：`isSafeUrl` + 回傳 URL/null）：合法 → `<a href>`；不合法 → **純文字 span（無 href）**。`HTTPS://` 接受（scheme 大小寫合法語意）；拒絕 `javascript:`/`data:`/protocol-relative/省略斜線/相對路徑/空值/前後空白。套用於：credentials URL、profile 連結、`cardViewModel` 的 `seriesUrl`/`latest.url`。
- profile URL 統一為完整絕對 URL `https://ithelp.ithome.com.tw/users/{id}`（`cardViewModel.profileUrl` 已是此格式；`user.profileUrl` 不直接作 href）。
- 系列卡 read-only：**無收藏按鈕、無 RSS 按鈕**（dead controls 禁止）。
- 系列列表跟隨年度切換（client 年度切換 fetch 完整 `data/{year}.json`，**不 re-compact**——比照 Dashboard `loadYear`）。
- 名單 key = ithelp `user.id`；name 不符 → `console.warn` 提示（非失敗）。
- 無系列名人 → 卡片隱藏；整年度無名人 → 空狀態「這個年度沒有名人參賽」。
- 沿用 `design-system.css` tokens（`--surface` / `--border` / `--muted` / `--accent` 等），無硬編碼 inline style（除既有 `padding-block:var(--space-4)` 模式）。
- 既有測試維持全綠（250 pass 起點）；改動後 `bun test` / `bunx tsc --noEmit` / `cd web && bun run build` 全過。

---

### Task 1: 資料層（`hall-of-fame.ts` + `famous-authors.json` + 單元測試）

**Files:**
- Create: `web/src/data/famous-authors.json`
- Create: `web/src/lib/hall-of-fame.ts`
- Create: `web/src/lib/hall-of-fame.test.ts`

**Interfaces:**
- Consumes: `ViewSeries` / `totalViewsOf` from `web/src/lib/card.ts`; `YearData` / `Series` from `../../../scripts/types`; real data `../../../data/2026.json`（測試用）。
- Produces:
  - `type FamousCategory = "speaker" | "community" | "oss" | "book"`
  - `type FamousEntry = { id: number; name: string; bio: string; credentials: { label: string; url: string }[]; categories: FamousCategory[] }`
  - `type FamousSeries = ViewSeries`
  - `type FamousRow = { entry: FamousEntry; series: FamousSeries[]; totalViews: number }`
  - `function loadFamousAuthors(): FamousEntry[]` —— 讀 JSON，object key 轉 `number` 進 `entry.id`
  - `function matchFamousAuthors(entries: FamousEntry[], data: YearData & { series: ViewSeries[] }): FamousRow[]` —— `entry.id ∈ series.user.id` join；無系列排除；依 `totalViews` desc 排序
  - `function isSafeUrl(url: string): boolean` —— 嚴格格式檢查 + parser protocol 驗證
  - `function safeHref(url: string): string | null` —— `isSafeUrl(url) ? url : null`（renderer 共用：不合法 → 不產生 href，改純文字）

- [ ] **Step 1: 建立名人清單 JSON**

`web/src/data/famous-authors.json`：

```json
{
  "20065770": {
    "name": "高見龍",
    "bio": "五倍紅寶石創辦人、Ruby 社群要角，長期推廣 Ruby / Rails 與技術寫作",
    "credentials": [
      { "label": "COSCUP 講師", "url": "https://coscup.org/" },
      { "label": "五倍紅寶石", "url": "https://5xruby.tw/" }
    ],
    "categories": ["speaker", "community"]
  }
}
```

> 名單初始只收高見龍（user.id `20065770`，已確認存在於 `data/2026.json`）。實作後可再擴充 2-4 位（須附可驗證來源連結，key 為該作者 ithelp user.id）。

- [ ] **Step 2: 寫失敗測試**

`web/src/lib/hall-of-fame.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { loadFamousAuthors, matchFamousAuthors, isSafeUrl, safeHref } from "./hall-of-fame";
import type { Series, YearData } from "../../../scripts/types";
import realData from "../../../data/2026.json";

function series(partial: Partial<Series> & { id: number; user: Series["user"] }): Series {
  return {
    group: "Software Development",
    title: "測試系列",
    description: "",
    team: null,
    signupDate: "2026/08/01T00:00:00+08:00",
    lastUpdated: null,
    dayCount: 1,
    articleCount: 1,
    subscriptions: 0,
    articles: [],
    ...partial,
  };
}

describe("loadFamousAuthors", () => {
  test("JSON key 轉 number 進 entry.id", () => {
    const entries = loadFamousAuthors();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(Number.isInteger(e.id)).toBe(true);
      expect(typeof e.name).toBe("string");
      expect(typeof e.bio).toBe("string");
      expect(e.credentials.length).toBeGreaterThan(0);
      for (const c of e.credentials) {
        expect(typeof c.label).toBe("string");
        expect(isSafeUrl(c.url)).toBe(true);
      }
      expect(e.categories.length).toBeGreaterThan(0);
      for (const cat of e.categories) {
        expect(["speaker", "community", "oss", "book"]).toContain(cat);
      }
    }
  });

  test("高見龍 (20065770) 在名單內", () => {
    const entries = loadFamousAuthors();
    const kao = entries.find((e) => e.id === 20065770);
    expect(kao).toBeDefined();
    expect(kao!.name).toBe("高見龍");
  });
});

describe("matchFamousAuthors", () => {
  const entries = loadFamousAuthors();

  test("entry.id join 出該名人系列；無系列名人排除", () => {
    const data: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "https://ithelp.ithome.com.tw/users/20065770/profile" } }),
      series({ id: 2, user: { id: 999, name: "無名", profileUrl: "https://ithelp.ithome.com.tw/users/999/profile" } }),
    ], scrapeLog: [] };
    const rows = matchFamousAuthors(entries, data);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry.id).toBe(20065770);
    expect(rows[0].series).toHaveLength(1);
    expect(rows[0].series[0].id).toBe(1);
  });

  test("該年度無系列 → 排除（隱藏）", () => {
    const data: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [], scrapeLog: [] };
    expect(matchFamousAuthors(entries, data)).toHaveLength(0);
  });

  test("totalViews 依 totalViewsOf 語意；排序 desc", () => {
    const data: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "x" }, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 100, likes: 0, comments: 0 }] }),
      series({ id: 2, user: { id: 20065770, name: "高見龍", profileUrl: "x" }, articles: [{ id: 2, day: 1, title: "b", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 200, likes: 0, comments: 0 }] }),
    ], scrapeLog: [] };
    const rows = matchFamousAuthors(entries, data);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalViews).toBe(300);
  });

  test("compact（sumViews）與 full（articles 求和）totalViews 一致", () => {
    const full: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "x" }, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 150, likes: 0, comments: 0 }] }),
    ], scrapeLog: [] };
    const compact: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      { ...full.series[0], sumViews: 150, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 150, likes: 0, comments: 0 }] },
    ], scrapeLog: [] };
    expect(matchFamousAuthors(entries, full)[0].totalViews).toBe(150);
    expect(matchFamousAuthors(entries, compact)[0].totalViews).toBe(150);
  });

  test("真實資料 sweep：名單每個 id 都存在且至少 1 個系列", () => {
    const data = realData as unknown as YearData;
    for (const e of entries) {
      const matches = data.series.filter((s) => s.user.id === e.id);
      expect(matches.length).toBeGreaterThan(0);
      const nameMatches = matches.filter((s) => s.user.name === e.name);
      if (nameMatches.length === 0) {
        console.warn(`[hall-of-fame] name mismatch: entry "${e.name}" (id ${e.id}) 在資料中的名稱為 "${matches[0]?.user.name}"`);
      }
    }
  });
});

describe("isSafeUrl", () => {
  test("合法 http(s) 通過", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
  });
  test("scheme 大小寫接受", () => {
    expect(isSafeUrl("HTTPS://example.com")).toBe(true);
  });
  test("不安全 URL 拒絕", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("Javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    expect(isSafeUrl("//evil.example")).toBe(false);
    expect(isSafeUrl("https:example.com")).toBe(false);
    expect(isSafeUrl("/users/20065770/profile")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl("  https://x  ")).toBe(false);
  });
  test("safeHref：合法回傳原 URL，不合法回傳 null", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("")).toBeNull();
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd web && bun test src/lib/hall-of-fame.test.ts`
Expected: FAIL（`hall-of-fame.ts` 不存在 → import error）

- [ ] **Step 4: 實作 `hall-of-fame.ts`**

`web/src/lib/hall-of-fame.ts`：

```ts
// web/src/lib/hall-of-fame.ts — 名人堂資料層（純函式、無 DOM、無副作用、可單元測試）。
// 名人身份資料來自 web/src/data/famous-authors.json（key = ithelp user.id），
// 與 YearData.series.user.id join —— scraper / data/ shape 零變動。
// URL 安全：所有外連一律過 isSafeUrl（嚴格前置檢查 + parser protocol 驗證）。
import type { YearData } from "../../../scripts/types";
import { totalViewsOf, type ViewSeries } from "./card";
import famousAuthors from "../data/famous-authors.json";

export type FamousCategory = "speaker" | "community" | "oss" | "book";
export type FamousEntry = {
  id: number;               // ithelp user.id（JSON object key 轉 number，join 唯一鍵）
  name: string;
  bio: string;
  credentials: { label: string; url: string }[];
  categories: FamousCategory[];
};
export type FamousSeries = ViewSeries;
export type FamousRow = {
  entry: FamousEntry;
  series: FamousSeries[];
  totalViews: number;
};

// URL 驗證：strict 前置檢查 + 解析後 protocol 驗證。
// new URL() 會正規化大寫 scheme / 省略斜線 / 前後空白，單靠 parser 無法拒絕這些案例。
export function isSafeUrl(url: string): boolean {
  if (typeof url !== "string" || url.trim() !== url) return false;   // 拒絕前後空白
  if (!/^https?:\/\//i.test(url)) return false;                       // 必須 https:// 或 http:// 開頭（scheme 大小寫接受）
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;   // 拒絕 protocol-relative（無 base 即 throw）與 malformed
  }
}

// renderer 共用：不合法 URL → null（不產生 href，改純文字）。
export function safeHref(url: string): string | null {
  return isSafeUrl(url) ? url : null;
}

// 讀 JSON 名單，object key（string）轉 number 進 entry.id。
export function loadFamousAuthors(): FamousEntry[] {
  const raw = famousAuthors as Record<string, Omit<FamousEntry, "id">>;
  return Object.entries(raw).map(([key, v]) => ({ id: Number(key), ...v }));
}

// 依 entry.id join 年度系列；無系列 → 排除；依 totalViews desc 排序。
// 輸入含 ViewSeries[]（完整 SSR Series 或 client compact ViewSeries 皆可），
// totalViews 由 totalViewsOf 決定（sumViews ?? articles 求和）——兩者語意一致。
export function matchFamousAuthors(
  entries: FamousEntry[],
  data: YearData & { series: ViewSeries[] },
): FamousRow[] {
  return entries
    .map((entry) => {
      const series = data.series.filter((s) => s.user.id === entry.id);
      if (series.length === 0) return null;   // 該年度無系列 → 隱藏
      const totalViews = series.reduce((n, s) => n + totalViewsOf(s), 0);
      return { entry, series, totalViews };
    })
    .filter((r): r is FamousRow => r !== null)
    .sort((a, b) => b.totalViews - a.totalViews);
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd web && bun test src/lib/hall-of-fame.test.ts`
Expected: PASS（含真實資料 sweep——高見龍 id 20065770 存在於 `data/2026.json` 且有系列）

- [ ] **Step 6: Commit**

```bash
git add web/src/data/famous-authors.json web/src/lib/hall-of-fame.ts web/src/lib/hall-of-fame.test.ts
git commit -m "feat: 名人堂資料層——famous-authors.json + hall-of-fame.ts join/isSafeUrl + 單元測試"
```

---

### Task 2: Client renderer（`buildReadOnlyCard` + DOM 契約測試）

**Files:**
- Create: `web/src/lib/hall-of-fame-dom.ts`
- Create: `web/src/lib/hall-of-fame-dom.test.ts`

**Interfaces:**
- Consumes: `cardViewModel` / `CardView` / `ViewSeries` from `./card`; `buildChip` from `./card-dom`; `isoInitial` from `./format`; happy-dom `Window`.
- Produces: `function buildReadOnlyCard(s: ViewSeries, today: string): HTMLElement` —— 同 `buildCard` 骨架（badge/chip/progress/title/meta/latest/updated/stat），**無 fav 與 RSS 按鈕**；profile 連結為絕對 URL。

- [ ] **Step 1: 寫失敗測試（DOM 契約）**

`web/src/lib/hall-of-fame-dom.test.ts`：

```ts
// hall-of-fame-dom 結構契約測試。
// 目的：read-only 卡片骨架（class / 欄位順序 / 無 fav-RSS controls）在此鎖成契約；
// 顯示決定（badge/chip/瀏覽/最新）來自 card.ts view-model——此處不做第二套判定。
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Series } from "../../../scripts/types";
import { buildReadOnlyCard } from "./hall-of-fame-dom";

const win = new Window();
(globalThis as Record<string, unknown>).document = win.document;

function sampleSeries(): Series {
  return {
    id: 9128,
    user: { id: 20065770, name: "高見龍", profileUrl: "https://ithelp.ithome.com.tw/users/20065770/profile" },
    group: "Software Development",
    title: "為你自己手刻 Claude Code",
    description: "",
    team: null,
    signupDate: "2026/08/01T00:00:00+08:00",
    lastUpdated: null,
    dayCount: 15,
    articleCount: 15,
    subscriptions: 0,
    articles: [{ id: 1, day: 15, title: "Day 15", url: "https://ithelp.ithome.com.tw/articles/1", publishedAt: "2026-08-19T10:00:00+08:00", views: 500, likes: 0, comments: 0 }],
  };
}

describe("buildReadOnlyCard", () => {
  test("骨架與 buildCard 一致（badge/chip/progress/title/meta/latest/stat）", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    expect(el.className).toBe("series-card");
    expect(el.querySelector(".card-head")).not.toBeNull();
    expect(el.querySelector(".progress")).not.toBeNull();
    expect(el.querySelector(".card-title")).not.toBeNull();
    expect(el.querySelector(".meta")).not.toBeNull();
    expect(el.querySelector(".latest")).not.toBeNull();
    expect(el.querySelector(".card-stat")).not.toBeNull();
    expect(el.querySelector(".card-stat")!.textContent).toContain("瀏覽");
  });

  test("無收藏與 RSS 按鈕（dead controls 禁止）", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    expect(el.querySelector(".card-fav")).toBeNull();
    expect(el.querySelector("[data-rss]")).toBeNull();
    expect(el.querySelectorAll(".card-action")).toHaveLength(0);
  });

  test("profile 連結為完整絕對 URL", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    const au = el.querySelector<HTMLAnchorElement>(".meta-author")!;
    expect(au.href).toBe("https://ithelp.ithome.com.tw/users/20065770");
    expect(au.textContent).toBe("高見龍");
  });

  test("無文章系列顯示 emptySlotText", () => {
    const s = { ...sampleSeries(), articles: [], articleCount: 0, dayCount: 0 };
    const el = buildReadOnlyCard(s, "2026-08-19");
    const latest = el.querySelector(".latest-link")!;
    expect(latest.textContent).not.toBe("");
  });

  test("updatedIso 存在時輸出 .updated time", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    const upd = el.querySelector(".updated time");
    expect(upd).not.toBeNull();
    expect(upd!.getAttribute("datetime")).toBe("2026-08-19T10:00:00+08:00");
  });

  test("不安全 URL → 不產生 href（純文字）", () => {
    const s = {
      ...sampleSeries(),
      user: { id: 20065770, name: "高見龍", profileUrl: "javascript:alert(1)" },
    };
    const el = buildReadOnlyCard(s, "2026-08-19");
    // 無任何 a[href] 是 javascript: 或空 href
    el.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      expect(a.href.startsWith("javascript:")).toBe(false);
      expect(a.getAttribute("href")).not.toBe("");
    });
    // meta-author 改純文字 span（非 a）
    const au = el.querySelector(".meta-author")!;
    expect(au.tagName).not.toBe("A");
    expect(au.textContent).toBe("高見龍");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && bun test src/lib/hall-of-fame-dom.test.ts`
Expected: FAIL（`hall-of-fame-dom.ts` 不存在）

- [ ] **Step 3: 實作 `hall-of-fame-dom.ts`**

`web/src/lib/hall-of-fame-dom.ts`：

```ts
// web/src/lib/hall-of-fame-dom.ts — 名人堂 read-only 系列卡 DOM 建構（client 專用，happy-dom 可測）。
// 顯示決定一律來自 cardViewModel（card.ts），與 SSR 的 HallOfFameSeriesCard.astro 共用同一 view-model；
// 結構（class / 欄位順序 / 無 fav-RSS controls）由 hall-of-fame-dom.test.ts 鎖成契約，防兩層 drift。
// 無 module-load 副作用：呼叫時才需要 document（與 card-dom.ts 同模式）。
import type { ViewSeries } from "./card";
import { cardViewModel } from "./card";
import { buildChip } from "./card-dom";
import { isoInitial } from "./format";
import { safeHref } from "./hall-of-fame";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag: string, attrs: Record<string, string>, children: SVGElement[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}

function eyeIcon(): SVGElement {
  return svgEl("svg", { class: "ico-eye", viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z" }),
    svgEl("circle", { cx: "12", cy: "12", r: "3", fill: "currentColor", stroke: "none" }),
  ]);
}

// Grid card（read-only）：與 buildCard 同骨架，但 card-head-right 只保留 stat，
// 無收藏星號（.card-fav）與 RSS 按鈕（[data-rss]）——名人堂無 Dashboard 的 fav/RSS infrastructure。
export function buildReadOnlyCard(s: ViewSeries, today: string): HTMLElement {
  const v = cardViewModel(s, today);
  const art = document.createElement("article");
  art.className = "series-card";
  const head = document.createElement("header");
  head.className = "card-head";
  const day = document.createElement("span");
  day.className = v.badgeClass; day.textContent = v.badgeText;
  const chip = buildChip(v);
  const headLeft = document.createElement("span");
  headLeft.className = "card-head-left";
  headLeft.append(day);
  if (chip) headLeft.append(chip);
  const right = document.createElement("div");
  right.className = "card-head-right";
  const stat = document.createElement("span");
  stat.className = "card-stat tabular-nums";
  stat.textContent = `${v.totalViews.toLocaleString()} 瀏覽`;
  right.appendChild(stat);   // 只保留 stat；無 fav / rss
  head.append(headLeft, right);

  const prog = document.createElement("div"); prog.className = "progress";
  const track = document.createElement("div"); track.className = "progress-track";
  const fill = document.createElement("div");
  fill.className = v.progressFillClass;
  fill.style.width = `${v.progressPct}%`;
  track.appendChild(fill);
  const pl = document.createElement("span");
  pl.className = "progress-label tabular-nums"; pl.textContent = v.progressLabel;
  prog.append(track, pl);

  const h = document.createElement("h2"); h.className = "card-title";
  const href = safeHref(v.seriesUrl);
  if (href) {
    const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = s.title;
    h.appendChild(a);
  } else {
    const span = document.createElement("span"); span.className = "card-title-plain"; span.textContent = s.title;
    h.appendChild(span);
  }

  const meta = document.createElement("p"); meta.className = "meta";
  const auHref = safeHref(v.profileUrl);
  if (auHref) {
    const au = document.createElement("a"); au.className = "meta-author"; au.href = auHref; au.target = "_blank"; au.rel = "noopener"; au.textContent = s.user.name;
    meta.appendChild(au);
  } else {
    const span = document.createElement("span"); span.className = "meta-author"; span.textContent = s.user.name;
    meta.appendChild(span);
  }
  meta.append(" · ", s.group, s.team ? ` · 團隊 ${s.team}` : "");

  const lat = document.createElement(v.latest ? "div" : "p"); lat.className = "latest";
  if (v.latest) {
    const laHref = safeHref(v.latest.url);
    if (laHref) {
      const la = document.createElement("a"); la.className = "latest-link"; la.href = laHref; la.target = "_blank"; la.rel = "noopener";
      const tag = document.createElement("span"); tag.className = "latest-tag"; tag.textContent = "最新";
      la.append(tag, v.latest.title);
      lat.appendChild(la);
    } else {
      const span = document.createElement("span"); span.className = "latest-link muted"; span.textContent = v.latest.title;
      lat.appendChild(span);
    }
    const lv = document.createElement("span"); lv.className = "latest-views tabular-nums";
    lv.appendChild(eyeIcon());
    lv.appendChild(document.createTextNode(`${v.latest.views.toLocaleString()} 當篇觀看`));
    lat.append(lv);
  } else {
    const span = document.createElement("span"); span.className = "latest-link muted"; span.textContent = v.emptySlotText;
    lat.appendChild(span);
  }

  art.append(head, prog, h, meta, lat);
  if (v.updatedIso) {
    const upd = document.createElement("p"); upd.className = "updated"; upd.textContent = "上次發布 ";
    const tm = document.createElement("time"); tm.dateTime = v.updatedIso; tm.dataset.ts = v.updatedIso;
    tm.textContent = isoInitial(v.updatedIso);
    upd.appendChild(tm); art.appendChild(upd);
  }
  return art;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web && bun test src/lib/hall-of-fame-dom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hall-of-fame-dom.ts web/src/lib/hall-of-fame-dom.test.ts
git commit -m "feat: 名人堂 client read-only 卡片 renderer + DOM 契約測試"
```

---

### Task 3: SSR 元件（`HallOfFameSeriesCard.astro` + 對齊契約測試）

**Files:**
- Create: `web/src/components/HallOfFameSeriesCard.astro`

**Interfaces:**
- Consumes: `cardViewModel` / `ViewSeries` from `../lib/card`; `isoInitial` from `../lib/format`; `Series` from `../../../scripts/types`。
- Produces: Astro 元件 `<HallOfFameSeriesCard series={Series} today={string} />` —— SSR read-only 卡片（與 `buildReadOnlyCard` 同結構）。

- [ ] **Step 1: 實作 SSR 元件**

`web/src/components/HallOfFameSeriesCard.astro`：

```astro
---
// web/src/components/HallOfFameSeriesCard.astro — 名人堂 read-only 系列卡（SSR 層）。
// 顯示決定全部委派給 cardViewModel（web/src/lib/card.ts）——與 client 的 buildReadOnlyCard
// （hall-of-fame-dom.ts）共用同一 view-model，兩層結構由 hall-of-fame-dom.test.ts 鎖定對齊。
// read-only：無收藏按鈕、無 RSS 按鈕（名人堂無 Dashboard 的 fav/RSS infrastructure，dead controls 禁止）。
import type { Series } from "../../../scripts/types";
import { cardViewModel, type ViewSeries } from "../lib/card";
import { isoInitial } from "../lib/format";
import { safeHref } from "../lib/hall-of-fame";

interface Props { series: Series; today?: string }
const { series } = Astro.props;
const v = cardViewModel(series as ViewSeries, Astro.props.today);
const seriesHref = safeHref(v.seriesUrl);
const profileHref = safeHref(v.profileUrl);
const latestHref = v.latest ? safeHref(v.latest.url) : null;
---

<article class="series-card">
  <header class="card-head">
    <span class="card-head-left">
      <span class={v.badgeClass}>{v.badgeText}</span>
      {v.chipText ? <span class={v.chipClass} title={v.chipTitle ?? undefined}>{v.chipText}</span> : null}
    </span>
    <div class="card-head-right">
      <span class="card-stat tabular-nums">{v.totalViews.toLocaleString()} 瀏覽</span>
    </div>
  </header>
  <div class="progress">
    <div class="progress-track"><div class={v.progressFillClass} style={`width:${v.progressPct}%`}></div></div>
    <span class="progress-label tabular-nums">{v.progressLabel}</span>
  </div>
  <h2 class="card-title">
    {seriesHref ? <a href={seriesHref} target="_blank" rel="noopener">{series.title}</a> : <span class="card-title-plain">{series.title}</span>}
  </h2>
  <p class="meta">
    {profileHref ? <a class="meta-author" href={profileHref} target="_blank" rel="noopener">{series.user.name}</a> : <span class="meta-author">{series.user.name}</span>}
    <span class="meta-sep">·</span>{series.group}{series.team ? <><span class="meta-sep">·</span>團隊 {series.team}</> : null}
  </p>
  {v.latest ? (
    <div class="latest">
      {latestHref ? (
        <a class="latest-link" href={latestHref} target="_blank" rel="noopener">
          <span class="latest-tag">最新</span>{v.latest.title}
        </a>
      ) : <span class="latest-link muted">{v.latest.title}</span>}
      <span class="latest-views tabular-nums">
        <svg class="ico-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>
        {v.latest.views.toLocaleString()} 當篇觀看
      </span>
    </div>
  ) : <p class="latest"><span class="latest-link muted">{v.emptySlotText}</span></p>}
  {v.updatedIso ? (
    <p class="updated">上次發布 <time datetime={v.updatedIso} data-ts={v.updatedIso}>{isoInitial(v.updatedIso)}</time></p>
  ) : null}
</article>
```

> 結構 mirror `SeriesCard.astro`，但 `card-head-right` **只含 stat**（無 fav/RSS）；`meta-author` href 為 `v.profileUrl`（絕對 URL `https://ithelp.ithome.com.tw/users/{id}`）。

- [ ] **Step 2: SSR/client 對齊驗證（改由 build 輸出驗證，非單元測試）**

Astro 5 無公開 `render()` API（`astro` package 不 export component render 工具），元件輸出不適合在 Bun test 直接呼叫。SSR/client 對齊改由 **Task 4 Step 7 的 build 輸出結構 checks** 承擔（`series-card`/`card-head`/`card-head-left`/`card-head-right`/`card-stat`/`progress`/`progress-track`/`progress-label`/`card-title`/`meta`/`meta-author`/`latest`/`latest-tag`/`latest-views` 皆存在、無 `card-fav`/`data-rss`、無不安全 href）。兩層共用同一 `cardViewModel`（顯示決定單一來源），`HallOfFameSeriesCard.astro` 的 markup 明確 mirror `buildReadOnlyCard`（僅 `card-head-right` 少 fav/RSS）。

> 若未來要程式化對齊測試，可將 `HallOfFameSeriesCard` 的 markup 抽成純函式（回傳 HTML string）供 SSR 與測試共用——本 plan 不引入（YAGNI）。

- [ ] **Step 3: 跑測試確認既有 DOM 契約仍綠**

Run: `cd web && bun test src/lib/hall-of-fame-dom.test.ts`
Expected: 5 個 DOM 測試 PASS（無 Astro 元件測試）

- [ ] **Step 4: Commit**

```bash
git add web/src/components/HallOfFameSeriesCard.astro
git commit -m "feat: 名人堂 SSR read-only 系列卡元件（對齊由 build 輸出驗證承擔）"
```

---

### Task 4: 頁面 + 元件 + Header 導覽 + 樣式

**Files:**
- Create: `web/src/pages/hall-of-fame.astro`
- Create: `web/src/components/HallOfFame.astro`
- Modify: `web/src/components/Dashboard.astro`（header-actions 加名人堂 icon）
- Modify: `web/src/components/Teams.astro`（header-actions 加名人堂 icon）
- Modify: `web/src/components/Insights.astro`（header-actions 加名人堂 icon）
- Modify: `web/src/styles/design-system.css`（名人卡 / 類別 chip / 來源連結樣式）

**Interfaces:**
- Consumes: `matchFamousAuthors` / `loadFamousAuthors` / `FamousRow` from `../lib/hall-of-fame`; `HallOfFameSeriesCard` from `../components/HallOfFameSeriesCard.astro`; `buildReadOnlyCard` from `../lib/hall-of-fame-dom`; `taipeiToday` from `../lib/daily-status`; `isoInitial` from `../lib/format`; `YearData` / `MetaJson` from `../../../scripts/types`。
- Produces: `/hall-of-fame/` 頁面（SSR 完整輸出 + client 年度切換重 render）；四頁 header 含名人堂 icon。

- [ ] **Step 1: 實作頁面 `web/src/pages/hall-of-fame.astro`**

```astro
---
// web/src/pages/hall-of-fame.astro — 名人堂分頁（SSG 最新年度 + client 年切換）。
import HallOfFame from "../components/HallOfFame.astro";
import type { MetaJson, YearData } from "../../../scripts/types";
import designSystemCss from "../styles/design-system.css?inline";

const dataByYear = new Map<number, YearData>();
for (const [path, mod] of Object.entries(import.meta.glob(["../../../data/*.json", "!../../../data/meta.json"], { eager: true, import: "default" }))) {
  const m = path.match(/(\d{4})\.json$/);
  if (m) dataByYear.set(Number(m[1]), mod as YearData);
}
const meta = (await import("../../../data/meta.json").then((m) => m.default)) as MetaJson;
const years = meta.years.filter((y) => dataByYear.has(y)).sort((a, b) => b - a);
const latestYear = years[0] ?? [...dataByYear.keys()].sort((a, b) => b - a)[0] ?? 0;
const emptyData: YearData = { year: 0, updatedAt: "", groups: [], series: [], scrapeLog: [] };
const data: YearData = latestYear !== 0 && dataByYear.has(latestYear) ? dataByYear.get(latestYear)! : emptyData;
---
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>鐵人觀察家 Next — 名人堂</title>
  <meta name="description" content={`${latestYear || ""} iThome 鐵人賽名人堂：認識參賽的知名技術人物與他們的系列`} />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="shortcut icon" href="/favicon.ico" />
  <link rel="preconnect" href="https://ithelp.ithome.com.tw" />
  <link rel="dns-prefetch" href="https://ithelp.ithome.com.tw" />
  <style is:inline set:html={designSystemCss} />
  <script is:inline>
    (function () {
      var stored = null;
      try { stored = localStorage.getItem("theme"); } catch (e) {}
      var root = document.documentElement;
      if (stored === "light" || stored === "dark") {
        root.setAttribute("data-theme", stored);
      } else {
        root.removeAttribute("data-theme");
      }
    })();
  </script>
</head>
<body>
  <HallOfFame data={data} years={years} latestYear={latestYear} />
</body>
</html>
```

- [ ] **Step 2: 實作元件 `web/src/components/HallOfFame.astro`**

```astro
---
// web/src/components/HallOfFame.astro — 名人堂頁面元件（SSR 完整輸出 + client 年度切換重 render）。
import type { YearData } from "../../../scripts/types";
import { matchFamousAuthors, loadFamousAuthors } from "../lib/hall-of-fame";
import { isoInitial } from "../lib/format";
import { taipeiToday } from "../lib/daily-status";
import HallOfFameSeriesCard from "./HallOfFameSeriesCard.astro";

interface Props { data: YearData; years: number[]; latestYear: number }
const { data, years, latestYear } = Astro.props;

// SSR 用 build 時點臺北日（taipeiToday——與 client 同基準；禁止 UTC 日期）。
const today = taipeiToday();
const entries = loadFamousAuthors();
const rows = matchFamousAuthors(entries, data);
const updatedAtFallback = isoInitial(data.updatedAt);
---

<header class="site-header container">
  <div class="header-row">
    <div class="brand">
      <h1 class="brand-title"><span class="brand-mark" aria-hidden="true"></span>鐵人觀察家 <span class="brand-next">Next</span></h1>
      <p class="brand-sub">名人堂</p>
    </div>
    <div class="header-actions">
      <select id="hof-year-select" class="sort-select" aria-label="切換年度">
        {years.length > 0 && years.map((y) => <option value={y} selected={y === data.year}>{y} 年</option>)}
      </select>
      <button id="theme-toggle" class="icon-btn" type="button" aria-label="切換明暗主題" title="切換明暗主題（自動 / 明 / 暗）">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      </button>
      <a class="icon-btn" href="/" aria-label="即時看板（系列列表）" title="即時看板（系列列表）">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z"/><polyline points="9,21 9,13 15,13 15,21"/></svg>
      </a>
      <a class="icon-btn" href="/teams/" aria-label="團隊計分板" title="團隊計分板">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
      </a>
      <a class="icon-btn is-active" href="/hall-of-fame/" aria-label="名人堂" title="名人堂">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1"/></svg>
      </a>
      <a class="icon-btn" href="/insights/" aria-label="Insights 分析" title="Insights 分析">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l4-5 3 3 5-7"/></svg>
      </a>
      <a class="icon-btn" href="https://github.com/kehao-chen/ithome-ironman-observer-next" target="_blank" rel="noopener" aria-label="GitHub 專案" title="GitHub 專案">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5A11.5 11.5 0 0 0 .5 12 11.5 11.5 0 0 0 8.36 23c.57.1.78-.25.78-.55v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.42.36.79 1.08.79 2.18v3.23c0 .3.21.66.79.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" fill="currentColor" stroke="none"/></svg>
      </a>
    </div>
  </div>
</header>

<main class="container hof-main" style="padding-block:var(--space-4);">
  <div class="status-bar" role="status">
    <span><span class="dot" aria-hidden="true"></span>資料已更新</span>
    <span>共 <strong id="hof-total-count" class="tabular-nums">{rows.length}</strong> 位名人參賽</span>
  </div>

  <div id="hof-list">
    {rows.map((row, i) => (
      <section class="hof-card" data-famous-id={row.entry.id}>
        <header class="hof-card-head">
          <h2 class="hof-name">
            <a class="meta-author" href={`https://ithelp.ithome.com.tw/users/${row.entry.id}`} target="_blank" rel="noopener">{row.entry.name}</a>
          </h2>
          <span class="hof-categories">
            {row.entry.categories.map((c) => {
              const label = c === "speaker" ? "講師" : c === "community" ? "社群" : c === "oss" ? "開源" : "書籍";
              return <span class="hof-cat-chip">{label}</span>;
            })}
          </span>
        </header>
        <p class="hof-bio">{row.entry.bio}</p>
        <ul class="hof-credentials">
          {row.entry.credentials.map((c) => {
            const href = isSafeUrl(c.url) ? c.url : null;
            return <li>{href ? <a href={href} target="_blank" rel="noopener">{c.label}</a> : <span class="hof-cred-plain">{c.label}</span>}</li>;
          })}
        </ul>
        <h3 class="hof-series-title">{data.year} 系列</h3>
        <div class="hof-series">
          {row.series.map((s) => <HallOfFameSeriesCard series={s} today={today} />)}
        </div>
      </section>
    ))}
  </div>

  <div class="hof-empty" id="hof-empty" role="status" aria-live="polite" hidden={rows.length > 0}>
    <p>這個年度沒有名人參賽</p>
  </div>
</main>

<script is:inline define:vars={{ initialData: data }}>
  window.HOF_DATA = initialData;
</script>

<script>
  import { taipeiToday } from "../lib/daily-status";
  import { matchFamousAuthors, loadFamousAuthors, isSafeUrl } from "../lib/hall-of-fame";
  import { buildReadOnlyCard } from "../lib/hall-of-fame-dom";
  import type { YearData } from "../../../scripts/types";

  const hofList = document.getElementById("hof-list")!;
  const hofEmpty = document.getElementById("hof-empty")!;
  const hofTotalCount = document.getElementById("hof-total-count")!;
  const yearSelect = document.getElementById("hof-year-select") as HTMLSelectElement | null;
  const themeToggle = document.getElementById("theme-toggle");
  const rootEl = document.documentElement;

  let current: YearData = (window as any).HOF_DATA;
  let today = taipeiToday();

  function render(data: YearData) {
    if (!data) return;
    current = data;
    if (yearSelect) yearSelect.value = String(data.year);
    const rows = matchFamousAuthors(loadFamousAuthors(), data);
    hofTotalCount.textContent = String(rows.length);
    hofEmpty.hidden = rows.length > 0;

    hofList.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const row of rows) {
      const section = document.createElement("section");
      section.className = "hof-card";
      section.dataset.famousId = String(row.entry.id);

      const head = document.createElement("header");
      head.className = "hof-card-head";
      const name = document.createElement("h2");
      name.className = "hof-name";
      const profileHref = `https://ithelp.ithome.com.tw/users/${row.entry.id}`;
      if (isSafeUrl(profileHref)) {
        const nameLink = document.createElement("a");
        nameLink.className = "meta-author";
        nameLink.href = profileHref;
        nameLink.target = "_blank"; nameLink.rel = "noopener";
        nameLink.textContent = row.entry.name;
        name.appendChild(nameLink);
      } else {
        const span = document.createElement("span");
        span.className = "meta-author";
        span.textContent = row.entry.name;
        name.appendChild(span);
      }
      const cats = document.createElement("span");
      cats.className = "hof-categories";
      for (const c of row.entry.categories) {
        const chip = document.createElement("span");
        chip.className = "hof-cat-chip";
        chip.textContent = c === "speaker" ? "講師" : c === "community" ? "社群" : c === "oss" ? "開源" : "書籍";
        cats.appendChild(chip);
      }
      head.append(name, cats);

      const bio = document.createElement("p");
      bio.className = "hof-bio"; bio.textContent = row.entry.bio;

      const creds = document.createElement("ul");
      creds.className = "hof-credentials";
      for (const c of row.entry.credentials) {
        const li = document.createElement("li");
        if (isSafeUrl(c.url)) {
          const a = document.createElement("a");
          a.href = c.url; a.target = "_blank"; a.rel = "noopener";
          a.textContent = c.label;
          li.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.className = "hof-cred-plain";
          span.textContent = c.label;
          li.appendChild(span);
        }
        creds.appendChild(li);
      }

      const seriesTitle = document.createElement("h3");
      seriesTitle.className = "hof-series-title";
      seriesTitle.textContent = `${data.year} 系列`;

      const seriesList = document.createElement("div");
      seriesList.className = "hof-series";
      for (const s of row.series) {
        seriesList.appendChild(buildReadOnlyCard(s, today));
      }

      section.append(head, bio, creds, seriesTitle, seriesList);
      frag.appendChild(section);
    }
    hofList.appendChild(frag);
  }

  async function loadYear(year: number) {
    try {
      const res = await fetch(`/data/${year}.json`);
      if (!res.ok) return;
      const fresh = (await res.json()) as YearData;
      render(fresh);
    } catch {}
  }

  yearSelect?.addEventListener("change", () => {
    const y = Number(yearSelect.value);
    if (Number.isInteger(y)) loadYear(y);
  });

  /* Theme toggle */
  function currentTheme(): string { try { return localStorage.getItem("theme") ?? "auto"; } catch { return "auto"; } }
  themeToggle?.addEventListener("click", () => {
    const next = currentTheme() === "auto" ? "light" : currentTheme() === "light" ? "dark" : "auto";
    try { if (next === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", next); } catch {}
    if (next === "auto") rootEl.removeAttribute("data-theme"); else rootEl.setAttribute("data-theme", next);
  });

  render(current);
</script>
```

> 注意：client 一律重跑 `matchFamousAuthors` + `buildReadOnlyCard`——SSR 用 `HallOfFameSeriesCard.astro`、client 用 `buildReadOnlyCard`，兩層同 view-model。`define:vars` 只傳 `initialData`（`rows` 不序列化——client 自行重算）。

- [ ] **Step 3: 加名人堂 icon 到三頁 header**

`web/src/components/Dashboard.astro`（在 teams icon 與 insights icon 之間插入；Dashboard 無 home icon）：

```astro
      <a class="icon-btn" href="/hall-of-fame/" aria-label="名人堂" title="名人堂">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1"/></svg>
      </a>
```

`web/src/components/Teams.astro` 與 `web/src/components/Insights.astro`：在 teams icon 與 insights icon 之間插入**同一段**（此二頁有 home icon，home 在最前、teams 其次、名人堂插在 teams 與 insights 之間——即上述 `<a>` 放在 teams `<a>` 之後、insights `<a>` 之前）。目前頁各自 `is-active`（名人堂頁自身已 `is-active`）。

- [ ] **Step 4: 加樣式到 `web/src/styles/design-system.css`**

在檔案末尾（`/* ---------- 名人堂 ---------- */` 區塊）追加：

```css
/* ---------- 名人堂 (Hall of Fame) ---------- */
.hof-main { padding-block: var(--space-4); }
.hof-card {
  display: flex; flex-direction: column; gap: var(--space-3);
  padding: var(--space-4); margin-bottom: var(--space-4);
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface);
}
.hof-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.hof-name { margin: 0; font-size: var(--text-lg); font-weight: 700; }
.hof-categories { display: inline-flex; gap: var(--space-1); }
.hof-cat-chip {
  padding: 2px 8px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--surface-muted); color: var(--muted); font-size: var(--text-xs); font-weight: 600;
}
.hof-bio { margin: 0; color: var(--muted); }
.hof-credentials { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
.hof-credentials a { color: var(--accent); text-decoration: none; }
.hof-credentials a:hover { text-decoration: underline; }
.hof-series-title { margin: var(--space-2) 0 0; font-size: var(--text-sm); color: var(--muted); }
.hof-series { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3); }
.hof-empty { text-align: center; padding: var(--space-6); color: var(--muted); }
.hof-empty[hidden] { display: none; }
```

> 若 `--text-lg` / `--text-sm` 等 token 不存在於 `design-system.css`，改用既有 token（`--text-base` 等；先 `grep -- "--text" web/src/styles/design-system.css` 確認）。`--surface-muted` 若不存在改用 `--surface`。

- [ ] **Step 5: 跑測試 + 型別**

Run: `cd web && bun test && cd .. && bunx tsc --noEmit`
Expected: 全綠（既有 250 + 新增 ~14）

- [ ] **Step 6: Build**

Run: `cd web && bun run build`
Expected: 成功，`dist/hall-of-fame/index.html` 產出

- [ ] **Step 7: Build 輸出驗證（SSR 結構 smoke checks）**

Run（依序）:
```bash
# 1. read-only controls 不存在（fav / RSS）
grep -c "card-fav\|data-rss" dist/hall-of-fame/index.html
# 期望: 0

# 2. 名人卡與 read-only 系列卡主要結構存在（class / 欄位）
grep -c "hof-card\|hof-name\|hof-bio\|hof-credentials\|hof-cat-chip\|hof-series" dist/hall-of-fame/index.html
# 期望: >0

# 3. 系列卡完整結構（SSR HallOfFameSeriesCard 輸出對齊 buildReadOnlyCard 的 class 契約）
for cls in series-card card-head card-head-left card-head-right card-stat progress progress-track progress-label card-title meta meta-author latest latest-tag latest-views; do
  grep -q "class=\"$cls" dist/hall-of-fame/index.html || echo "MISSING: $cls"
done
# 期望: 無 MISSING 輸出

# 4. 高見龍存在（名人卡 SSR 輸出）
grep -o "高見龍" dist/hall-of-fame/index.html | head -1
# 期望: 高見龍

# 5. 無不安全 href（javascript: / data: / // / 前後空白）
grep -E 'href="(javascript:|data:|//| *https)' dist/hall-of-fame/index.html && echo "UNSAFE HREF FOUND" || echo "OK: 無不安全 href"
# 期望: "OK: 無不安全 href"

# 6. profile 連結為完整絕對 URL
grep -o "https://ithelp.ithome.com.tw/users/20065770" dist/hall-of-fame/index.html | head -1
# 期望: https://ithelp.ithome.com.tw/users/20065770
```

> 這些 checks 鎖定 SSR 輸出**具備** read-only 卡完整結構、**無** fav/RSS、**無**不安全 href——與 client `buildReadOnlyCard` 共用同一 `cardViewModel`，兩層顯示決定單一來源（結構差異由 view-model 契約保證）。

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/hall-of-fame.astro web/src/components/HallOfFame.astro web/src/components/Dashboard.astro web/src/components/Teams.astro web/src/components/Insights.astro web/src/styles/design-system.css
git commit -m "feat: 名人堂頁面 + 元件 + header 導覽 + 樣式（SSR 完整輸出 + client 年切換）"
```

---

### Task 5: README / PRODUCT 同步 + 全量驗證

**Files:**
- Modify: `README.md`（Features 加名人堂）
- Modify: `PRODUCT.md`（roadmap 加名人堂候選並標記完成）

**Interfaces:**
- Consumes: 前四 Task 全部產出。

- [ ] **Step 1: 更新 `README.md`**

在 Features/功能清單處加一行（沿用既有格式，先 `grep -n "團隊\|Insights\|收藏" README.md` 找位置）：

```markdown
- **名人堂**（/hall-of-fame/）：表列具公眾知名度的參賽作者（如高見龍），附一句話介紹、可驗證來源連結與其系列文章。
```

- [ ] **Step 2: 更新 `PRODUCT.md`**

在 Roadmap「Mid-term candidates」區塊加（仿 Teams 條目格式）：

```markdown
- [x] **Hall of Fame / 名人堂**（完成 2026-08-19）：`web/src/data/famous-authors.json`（key = ithelp user.id）+ `web/src/lib/hall-of-fame.ts` 純函式 join；獨立頁面 `/hall-of-fame/`（SSR + client 年切換）；read-only 系列卡（SSR `HallOfFameSeriesCard.astro` ↔ client `buildReadOnlyCard`，共用 `cardViewModel`）；收錄標準：研討會講師/社群核心/開源作者/書籍作者，每條附可驗證來源連結；無系列年度隱藏。
```

- [ ] **Step 3: 全量驗證**

Run（依序）:
```bash
bun test                 # 全綠（既有 + 新增）
bunx tsc --noEmit        # 型別乾淨
cd web && bun run build  # Astro build 成功
```

Expected: 三項全過。

- [ ] **Step 4: 手動 headless 驗證（browser）**

用 browser 工具載入 `/hall-of-fame/`：
1. 名人卡出現（高見龍必含）、bio / 類別 chips / 來源連結正確。
2. 來源連結可點擊且為 `http(s)`；無 `javascript:` / `//` / 省略斜線 / 前後空白。
3. 系列卡無收藏 / RSS 按鈕；欄位與 dashboard 一致（title / DAY badge / 瀏覽 / 狀態 chip / 發文時間 / profile 連結）。
4. 年度切換：重 join、無系列名人隱藏、空年度顯示空狀態。
5. 無 console error、無 XSS（DOM 無 `innerHTML` 注入痕跡）。

- [ ] **Step 5: Commit**

```bash
git add README.md PRODUCT.md
git commit -m "docs: 名人堂 README/PRODUCT 同步"
```
