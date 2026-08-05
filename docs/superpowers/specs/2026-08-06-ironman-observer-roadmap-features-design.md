# Design: 多年度支援 + scrapeLog 錯誤提示（Roadmap Near-term）

> Status: Approved 2026-08-06（brainstorming 流程）。Follows the competition-board design system（`DESIGN.md`）。
> Scope: PRODUCT.md roadmap near-term 第 1、3 項（第 2 項「今日發文」已於 2026-08-05 daily-status spec 完成）。

## Problem

- PRODUCT.md near-term 第 1 項：**multi-year support** 未做。`data/2026.json` 已 year-named、`config/series-manifest.json` 是 per-year 單一來源，但 scraper CLI 只處理單一年度（manifest 是單一物件、寫死 `data/{year}.json` 一支），UI 無年度切換器。架構留了空間，未接上。
- near-term 第 3 項：**scrapeLog 從未顯示**。`runScrape` 已把每系列失敗寫入 `YearData.scrapeLog: string[]`（格式 `"{seriesId}: {message}"`），但 UI 完全沒有呈現。抓取靜默失敗時使用者無從得知資料缺漏。

## Goal

1. 多年度：scraper CLI 支援 manifest 內所有年度，逐一產出 `data/{year}.json`；UI 提供年度切換器，切換即重渲染（組別篩選、排序、統計全隨年度資料走）。目前只有 2026 一年，切換器先就位（單一選項），2027 起自動出現。
2. scrapeLog：status-bar 角落顯示「N 支系列本次抓取失敗」notice，可展開錯誤清單。資料無失敗時完全隱藏（現況 `scrapeLog` 為空 → 預設不顯示）。

零 scraper 抓取邏輯變動（只改 CLI orchestration）；維持 zero-cost 契約（無後端、JSON 即 DB）。

## Non-Goals

- 不做年份間資料比對/合併（跨年度趨勢是另一個功能）。
- 不做年度資料的「回溯補抓」：manifest 只列今年；過往年度需另行建 manifest entry + 手動跑一次。
- 不把 `scrapeLog` 改造成 per-series 結構或加時間戳：現有 `string[]` 夠用，只做呈現。
- 不做錯誤重試的 UI 控制（重試屬 scraper 行為，不變）。

## 1. 多年度支援

### 1.1 Config：manifest 改為年度陣列

`config/series-manifest.json` 從單一物件改為陣列（per-year entry 形狀不變）：

```json
[
  { "year": 2026, "signupListUrl": "https://ithelp.ithome.com.tw/2026ironman/signup/list" }
]
```

`scripts/types.ts`：`Manifest` 保持「單一年度 entry」型別（`runScrape(manifest: Manifest)` 簽名不變）；新增 `MetaJson` 型別：

```ts
export type Manifest = { year: number; signupListUrl: string }; // per-year entry
export type MetaJson = { latestYear: number; years: number[]; updatedAt: string; seriesCount: number };
```

### 1.2 Scraper CLI（`scripts/scrape.ts` `import.meta.main`）

- 讀 manifest 陣列 → 逐年度 `runScrape(m)`。
- 每年度空資料防護（沿用現有語意，改為 per-year）：該年度 `series.length === 0` → **跳過該年度寫檔**（保留上次資料）、記 error、繼續其他年度。
- 至少一年成功寫檔 → exit 0（成功年度照常 commit + deploy）；全部年度都失敗 → `process.exit(1)`（workflow 失敗、不 commit）。
- `data/meta.json` 改寫為 `{ latestYear, years, updatedAt, seriesCount }`：`years` = **成功寫檔**年度 desc 排序（切換器選項只列出有資料檔的年度，避免 404）、`latestYear` = `years[0]`、`updatedAt`/`seriesCount` = `latestYear` 對應年度資料的值。
- `runScrape` 本身、`mergeCardsAndStats`、各 parser **零變動**。

### 1.3 Build 端（`web/scripts/copy-data.mjs`）

- 目前只 copy `data/2026.json` → 改為 copy `data/` 下所有 `^\d{4}\.json$` 檔（不 copy `meta.json` 到 public——client 不需要，避免多一份 index）。

### 1.4 頁面（`web/src/pages/index.astro`）

- 用 `import.meta.glob("../../../data/*.json", { eager: true, import: "default" })` 拿全部年度資料，依檔名過濾 `^\d{4}\.json$`，`latestYear = max(years)`，初始渲染資料 = latest year（`data`）。
- `<title>` 改為 `鐵人觀察家 ${latestYear}`。
- **移除** `index.astro` 內的 60s refresh `<script>` 與 `ironman-data` CustomEvent——資料狀態（currentYear）集中到 Dashboard script 管理（見 1.6），refresh 移入 Dashboard。Dashboard 的 `window.IRONMAN_DATA` inline embed 保留為初始渲染來源。

### 1.5 Dashboard 年度切換器（`web/src/components/Dashboard.astro`）

- Props 增加 `years: number[]`（Astro 側傳入；SSR 從 glob 結果推導）。
- Header `header-actions` 最左新增 `<select id="year-select" class="sort-select" aria-label="切換年度">`，選項 = `years` desc（`<option value="2026">2026 年</option>`，value 綁定 currentYear）。
- Brand `brand-year` span 加 `id="brand-year"`：`render(data)` 時以 `data.year` 更新其文字（切年度時年份即時變）。
- **client script 變更**：
  - 新增 `let currentYear: number`（初始 = 初始資料的 `data.year`）。
  - `render(data)`：更新 `currentYear = data.year`、`brand-year`、`series-count`/`total-count`、`updated-at`（沿用現有邏輯）；**年度改變時**重建組別 filter chips（見 1.7）；`scrapeLog` notice 更新（見 2）。
  - `#year-select` change → `fetch(\`/data/${year}.json?t=${Date.now()}\`, { cache: "no-store" })` → `render(fresh)`（直接呼叫，不再走 CustomEvent）；fetch 失敗保留現況。
  - 60s refresh 移入本 script：`setInterval(() => fetch(\`/data/${currentYear}.json?t=…\`) → render(fresh), 60000)`。既有 `humanizeAll` 60s 週期保留為獨立 interval（互不干擾）。

### 1.6 組別 filter 重建 + 事件委派

- 現況：filter buttons 是 SSR 靜態 markup，client `querySelectorAll(".filter-btn").forEach(addEventListener)` 只在載入時綁一次；切年度重建 buttons 會失綁。
- 改為**容器事件委派**：`#group-filters` 單一 `click` listener，`e.target.closest(".filter-btn")` 處理。SSR 與重建 buttons 共用，不需重綁。
- 年度切換時重建 chips：`renderFilters(groups: string[], counts: Map, activeGroup)` — `createElement` + `textContent`（組別名是爬蟲資料，禁 innerHTML），active 重置為「全部」。
- 非年度切換的 refresh 路徑**不**重建 filter（保留使用者目前選的組別）；`applyFilter` 的 active 讀取（`document.querySelector(".filter-btn[data-active='true']")`）不變，對重建後 buttons 同樣有效。

### 1.7 Client fetch 路徑一致性

- 初始渲染：SSR embed（`IRONMAN_DATA`）。
- 任何 fetch（切年度、60s refresh）：`/data/{year}.json?t=…`，與 `web/public/data/{year}.json` 對應。

## 2. scrapeLog 錯誤提示

- **放置**：`status-bar` 內、`已顯示 N / M` 之後，`<details class="scrape-log" id="scrape-log">`：
  - `<summary>`：`⚠ N 支系列本次抓取失敗`（danger 色系）。
  - `<ul id="scrape-log-list">`：每項 = 一條錯誤字串。
- **SSR**：`data.scrapeLog.length > 0` 才輸出；內容直接 Astro 插值（自動 escape）。
- **Client**：`render(data)` 同步更新 — count 文字、清空重建 `<ul>`（`textContent` only，錯誤訊息可能含 HTML-ish 內容，禁 innerHTML）、`hidden` toggle。60s refresh 後若有失敗會自動浮現。
- **樣式**：`design-system.css` 新增 `.scrape-log` / `.scrape-log summary` / `.scrape-log ul`（danger-weak 底、danger 字、小字、`--radius`）；`summary` 游標 pointer、`list-style: none`（自訂 marker 或省略）。
- 現況資料 `scrapeLog: []` → notice 不渲染（隱形安全網，驗證時用合成 fixture 測）。

## 3. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `config/series-manifest.json` | 單一物件 → 年度陣列 |
| `scripts/types.ts` | 新增 `MetaJson`（`Manifest` 保持 entry 型別） |
| `scripts/scrape.ts` | CLI 改為逐年度：per-year 空資料防護、meta.json 新形狀（`latestYear`/`years`）、全失敗才 exit 1 |
| `web/scripts/copy-data.mjs` | glob copy 所有 `data/*.json`（year 檔） |
| `web/src/pages/index.astro` | glob 年度資料、`<title>` 帶 year、移除 refresh script + CustomEvent |
| `web/src/components/Dashboard.astro` | `years` prop、年度 `<select>`、`brand-year` id、`render()` 同步 year/brand/scrapeLog、filter 事件委派 + 年度切換重建、60s refresh 移入、scrapeLog `<details>`（SSR + client） |
| `web/src/styles/design-system.css` | `.scrape-log` 樣式 |
| `scripts/scrape.test.ts` | （視實作）新增 meta shape / years 排序純函數測試 |
| `PRODUCT.md` | roadmap near-term 1–3 全數標記完成 |

不改：`runScrape`、各 parser、`fetch-html`、`daily-status.ts`、`SeriesCard.astro`、`data/2026.json` 內容 shape、`.github/workflows/update.yml`（`bun run scripts/scrape.ts` 已覆蓋多年度；`git add data/ web/public/data/` 已涵蓋新年度檔）。

## 4. 測試策略

- **單元**（沿用 fixture-based 不打網）：若抽取純 helper（如 meta 建構）則測之；`bun test` 全綠（既有 18 pass + 新增）。
- **型別**：`bunx tsc --noEmit` 全專案乾淨。
- **Build**：`cd web && bun run build` 成功；`web/public/data/` 含 `2026.json`（不含 `meta.json`）。
- **手動 headless browser**：
  1. 正常載入：年度 select 顯示 2026、filter/sort 正常、`scrapeLog` 無 notice（現況空）。
  2. 年度切換：暫時加入合成 `data/2025.json` + 更新 manifest/meta → build → 切換 2025 確認 filter chips 重建、統計、brand-year、sort 全跟著變 → 移除合成檔並 rebuild（不留垃圾）。
  3. scrapeLog：暫時在 `data/2026.json` 注入 2 條錯誤 → build → notice 出現、展開顯示錯誤清單、無 XSS（client DOM 一律 `textContent`）→ 還原並 rebuild。
  4. 60s refresh：更新 public JSON 後等一個週期，確認目前年度資料刷新、無 console error。

## 5. 風險

- **年度切換與 60s refresh 的 race**：refresh 用 `currentYear`（render 時同步），不會切到一半被舊年度覆蓋；fetch 失敗保留現況（既有 try/catch 語意）。
- **filter 重建丟失使用者狀態**：僅年度切換時重置為「全部」——可接受（年度不同、組別集合可能不同，保留舊組別反而錯）。
- **`import.meta.glob` eager 會把全部年度 JSON 打包**：年度數量極少（每年一支），256KB × N 可接受；SSG 下為 build 期資料，不影響 runtime 成本。
- **manifest 改陣列的向後相容**：唯一讀者是 scraper CLI（同步改）；workflow 無感知。
- **meta.json 語意**：`updatedAt`/`seriesCount` 改為「最新年度」值——文件（PRODUCT.md/README）一併註明，避免誤讀。
