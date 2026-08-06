# 鐵人觀察家 Insights — Design Spec

- Date: 2026-08-06
- Status: draft
- Related: PRODUCT.md roadmap "Mid-term candidates"（Search/favorites 之後的資料分析方向）

## 1. Goal

在現有「鐵人觀察家」儀表板之外，新增一個 **Insights 分頁**，把 2026 iThome 鐵人賽的資料用圖表視覺化，讓使用者一眼看懂「發文行為、人氣結構、組別生態、文字趨勢」四個面向。

同時建立**歷史快照機制**（方向 5 的基礎）：每次 scrape 成功時把當日全量資料另存一份到 `data/history/{year}/{date}.json`，為日後的趨勢/動量/棄賽分析累積時間序列資料（方向 6/7 不在本 spec 範圍，但資料收集要先做）。

## 2. Non-goals（本 spec 明確不做）

- 方向 5（歷史趨勢圖）、6（動量）、7（棄賽/完賽率）：**資料還沒累積**，圖表硬做只是空殼。歷史快照機制先上，資料夠了再開新 spec。
- 互動式圖表（Chart.js / uPlot）：v1 用 **SSG SVG + 原生 JS tooltip**，零依賴。
- 文字分析的進階 NLP（情感分析、主題建模）：v1 只做**標題關鍵字統計**（可解讀、不需外部模型）。

## 3. Architecture

```
┌─ data pipeline（每 10 分鐘 cron）
│   scrape.ts ──► data/{year}.json        （現有，覆寫）
│            └──► data/history/{year}/{date}.json  （新增，當日快照）
│
└─ web（Astro SSG，零依賴）
    pages/insights.astro          ← 新分頁
    lib/insights.ts               ← 純函式：YearData → Insight 計算結果
    lib/insights.test.ts          ← 單元測試（純函式層）
    components/Insights.astro     ← 版面 + SSG SVG 渲染
    styles/insights.css           ← Insights 專用樣式（沿用 design-system tokens）
```

### 3.1 資料流

- `scrape.ts` 在 `stageWrites` 之前，把當次 `YearData` 依 `updatedAt` 的日期另存為 `data/history/{year}/{date}.json`（與 `{year}.json` 相同結構，完整保留）。
- 每日多次 scrape 只保留**當日最後一次**（檔名含日期，天然去重）。
- 歷史快照**不進** `meta.years`、不影響年切換器（那是現役資料的權威）。
- Astro `insights.astro` 用 `import.meta.glob("../../../data/*.json")` 讀 `{year}.json`（與 `index.astro` 相同 pattern），計算 Insights。

### 3.2 計算層（pure functions，`web/src/lib/insights.ts`）

全部接受 `YearData`，回傳可序列化的純資料（無 DOM）：

| Function | 輸入 | 輸出 | 對應方向 |
|---|---|---|---|
| `publishHourHistogram` | articles | `[{hour, count}]`（0–23） | 1 發文行為 |
| `publishWeekdayHistogram` | articles | `[{weekday, count}]` | 1 發文行為 |
| `viewsDistribution` | articles | `{ total, max, p50, p90, p99, top10PctShare, buckets }` | 2 人氣結構 |
| `topSeriesByViews` | series | `[{name, views, dayCount, likes}]` top N | 2 人氣結構 |
| `groupStats` | series | `[{group, seriesCount, articleCount, avgViews, totalSubscriptions}]` | 3 組別分析 |
| `titleKeywordStats` | series titles | `[{keyword, count}]` | 4 文字分析 |

## 4. Insights 分頁設計

### 4.1 路由與導覽

- 新頁面 `web/src/pages/insights.astro`，路徑 `/insights/`。
- 現有 Dashboard header 加一個「Insights」連結（header-actions 內，icon 或文字按鈕），與「GitHub」並排。
- 頁面用**同一套 site-header**（品牌 + 年切換器 + 主題切換），年切換器沿用 `meta.years` 權威邏輯，切換時 `location.href = /insights/?year=N`（SSG 預渲染，query param 由 Astro 讀取）。
- Insights 頁保持與首頁一致的 design-system：`design-system.css` tokens（`--bg/--surface/--accent/--border`）、`container`、面板用 `surface` + hairline border。

### 4.2 版面（四個面板，垂直堆疊）

每個面板 = `section.insight-panel`（surface bg + 1px hairline + radius），標題用 mono caps readout 風格。

```
┌──────────────────────────────────────────────┐
│ site-header（品牌 + Insights 年切換 + 主題）   │
├──────────────────────────────────────────────┤
│ 發文行為   「00 時為發文高峰」                 │
│  [SVG: 24 小時長條圖]  [SVG: 週末/平日長條圖]  │
├──────────────────────────────────────────────┤
│ 人氣結構   「前 10% 文章佔總觀看 X%」           │
│  [SVG: 觀看分佈長尾曲線]  [SVG: 訂閱龍頭橫條圖] │
├──────────────────────────────────────────────┤
│ 組別分析   「AI Engineering 最活躍」           │
│  [SVG: 組別文章數/平均觀看散點]                │
├──────────────────────────────────────────────┤
│ 文字分析   「『AI』出現 42 次」                │
│  [SVG: 關鍵字長條圖]  [SVG: 字數分佈]          │
└──────────────────────────────────────────────┘
```

- 每個面板標題旁附一行**自動生成的洞察句**（如「前 10% 文章佔總觀看 63%」），由計算層回傳的數字產生。
- 圖表 = SSG 時 Astro 元件把計算結果渲染成 inline SVG（`<svg>` 直接輸出在 HTML 裡）。
- 互動：hover 到 bar/point 顯示 tooltip（原生 JS，`<title>` 或 `data-*` + 定位 tooltip div）。v1 先做 `<title>` 工具提示（零成本、a11y 友善），再評估是否需要定位 tooltip。

### 4.3 SVG 渲染方式

- 每個圖表一個 Astro 子元件：`components/charts/BarChart.astro`、`LineChart.astro`、`ScatterChart.astro`（泛用，吃 `{ data, xLabel, yLabel, color }`）。
- 圖表資料 → SVG 座標的計算放 pure function（`lib/charts.ts`），SSG 時同步算好，不需 client JS。
- 用 `preserveAspectRatio` + `viewBox`，寬度 100%、高度固定，RWD 縮放。
- 顏色用 design-system tokens（`var(--accent)` 等），light/dark 自動。

## 5. History snapshot（方向 5 基礎）

### 5.1 檔案

```
data/history/{year}/{YYYY-MM-DD}.json
```

- 與 `{year}.json` **相同結構**（`YearData`），一次寫入，內容為當日最後一次 scrape 的全量資料。
- 檔名日期 = `updatedAt` 的臺北日期（`taipeiTimestamp` 的日期部分）。
- 舊檔覆寫（同一天多次 scrape 只留最後一次）。

### 5.2 寫入時機（scrape.ts 改動）

在 `runScrape` 回傳 `YearData` 後、`stageWrites` 前，於 `collectYears`/CLI 流程中：

1. 對每個成功年度，算出 `historyPath = data/history/{year}/{date}.json`。
2. 若該檔已存在且內容相同（hash 比對），跳過不寫（避免無變更 commit）。
3. 否則寫入（與 `{year}.json` 同目錄階層，`mkdir -p`）。

- **不影響**現有 atomic commit 協議（`stageWrites`/`commitWrites` 只處理 `{year}.json` + `meta.json`；history 快照是獨立寫入，失敗不 rollback 主檔）。
- **GitHub Actions 流程**：`data/history/**` 納入既有 `git add -A` + commit 範圍（無變更時既有邏輯已會 skip commit）。

### 5.3 讀取（未來）

- Insights v1 **不讀** history 檔（方向 5–7 留待後續 spec）。
- 檔案結構即 `YearData`，未來 `lib/insights-trends.ts` 可直接讀多日快照算趨勢。

## 6. Error Handling

- Insights 頁若某年度資料缺失：顯示空狀態（「此年度尚無資料」），不 crash。
- 計算層 pure function：空 articles/series 回傳空陣列/零值，不 throw。
- SVG 渲染：資料為空時渲染空的佔位面板 + 洞察句「尚無資料」。
- History 寫入失敗：僅 `console.error`，不影響主 scrape 流程（`{year}.json` 照常寫出）。

## 7. Testing

- **計算層**（`lib/insights.test.ts`，bun test，與現有 `lib/*.test.ts` 同 pattern）：
  - `publishHourHistogram`：0–23 全覆蓋、空陣列、跨日文章。
  - `viewsDistribution`：長尾計算（top10PctShare）、極值、空陣列。
  - `groupStats`：組別聚合、平均、空組。
  - `titleKeywordStats`：分詞、停用詞、大小寫、空標題。
- **History 寫入**（`scripts/scrape.test.ts` 擴充）：mock 檔案系統驗證「同日覆寫 / 不同日新增 / 相同內容跳過」。
- 不測 SVG 渲染（Astro 元件層，靠手動視覺驗證）。

## 8. 效能

- SSG 預渲染 = 圖表在 HTML 內，無 client 計算、無 JS 依賴。
- 計算層 O(n) 一次遍歷，428 篇文章 / 127 系列量級可忽略。
- History 快照每 10 分鐘一次全量寫入（~274KB/次，commit 前去重）。

## 9. Acceptance Criteria

1. `/insights/` 頁可達，header 有連結，年切換器運作（切年度重新載入該年資料）。
2. 四個面板（發文行為/人氣結構/組別分析/文字分析）皆有 SSG SVG 圖表 + 自動洞察句。
3. 圖表 hover 有 tooltip（`<title>` 即可）。
4. 無資料年度顯示空狀態，不 crash。
5. `data/history/2026/2026-08-06.json` 在下次 scrape 後存在，結構與 `2026.json` 相同。
6. 同日多次 scrape 只留最後一次快照；無變更不 commit。
7. 現有功能（Dashboard、年切換、收藏、搜尋）不 regression。
