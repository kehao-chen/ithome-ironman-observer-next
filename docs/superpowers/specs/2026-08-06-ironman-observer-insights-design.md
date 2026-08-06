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
| `topSeriesBySubscriptions` | series | `[{name, subscriptions, dayCount, views}]` top N | 2 人氣結構 |
| `groupStats` | series | `[{group, seriesCount, articleCount, avgViews, totalSubscriptions}]` | 3 組別分析 |
| `titleKeywordStats` | series titles | `[{keyword, count}]` | 4 文字分析 |

### 3.3 文字分析定義（v1，保守且可測試）

不引入外部 NLP 套件；「關鍵字」統計採以下固定規則：

- **統計對象**：**只分析每個系列的 `Series.title`**。不分析 `Series.description`，也不分析 `Article.title`（避免結果變成描述/文章內容分析而非標題趨勢）。
- **Token 切分**：英文/數字連續字串（`/[A-Za-z0-9]+/`）視為一個 token，大小寫正規化（lowercase）後統計。
- **中文**：不宣稱完整分詞。使用**預先定義的關鍵詞字典**比對（v1 字典由人工列舉，見下方），不在執行期做任意切詞。
- **計數單位**：統計值 = **「包含該關鍵字的系列標題數」**（每個系列標題對同一關鍵字最多計 1），不是字串出現總次數。
- **排除規則**：排除純標點、純數字、長度 1 的中文 token、純英文停用詞（a/an/the/of/for/with/and/to/in/on/at/from/by/is/are 等）。
- **排序**：依 `count` desc，同 count 依 `keyword` localeCompare asc（穩定排序）。
- **v1 中文關鍵詞字典**：人工預先列出（如：AI、機器學習、K8s、Kubernetes、安全、雲端、前端、後端、資料、開發、部署、測試、開源、效能、設計、自動化、Vibe、SideProject 等），由系列標題比對。字典集中於 `lib/keywords.ts` 單一檔案，易於日後擴充。
- **誠實命名**：若最後不採字典，函式改名為 `titleTokenStats`，並在 UI 註明「僅統計英文/數字 token，非完整中文關鍵字分析」。v1 預設**採用字典版**。

## 4. Insights 分頁設計

### 4.1 路由與導覽

- 新頁面 `web/src/pages/insights.astro`，路徑 `/insights/`。
- 現有 Dashboard header 加一個「Insights」連結（header-actions 內，icon 或文字按鈕），與「GitHub」並排。
- 頁面用**同一套 site-header**（品牌 + 年切換器 + 主題切換），主題切換沿用首頁的 inline script。
- **年切換為 client-side（與 Dashboard 相同模式，不是 SSR query param）**：
  - `/insights/` 是單一 SSG 頁面，build 時只用 `latestYear` 的資料預渲染一份 HTML。
  - 年切換器 `change` 時 `fetch(`/data/${year}.json?t=${Date.now()}`, { cache: "no-store" })` 取年度資料，client-side 重算 Insights 並重繪（見 §4.4）。
  - 用 `history.replaceState` 同步 `?year=N` 到網址列，分享/重新整理後可還原。
  - 初始載入讀 `location.search` 的 `year`；無效或缺失 fallback 到 `latestYear`；`meta.years` 仍是唯一可選年度來源。
  - 說明：Astro `output: "static"` 下 `/insights/?year=N` 不會觸發 server-side 重新渲染，frontmatter 讀 `Astro.url.searchParams` 只能拿到 build 時那份資料，故不得用 query param 驅動 SSR。
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
│  [SVG: 觀看分佈分桶長條圖]  [SVG: 訂閱龍頭橫條圖]│
├──────────────────────────────────────────────┤
│ 組別分析   「AI Engineering 最活躍」           │
│  [SVG: 組別文章數/平均觀看散點]                │
├──────────────────────────────────────────────┤
│ 文字分析   「N 個系列標題包含『AI』」          │
│  [SVG: 關鍵字長條圖]  [SVG: 字數分佈]          │
└──────────────────────────────────────────────┘
```

- 每個面板標題旁附一行**自動生成的洞察句**（如「前 10% 文章佔總觀看 63%」），由計算層回傳的數字產生。
- 圖表 = SSG 時 Astro 元件把計算結果渲染成 inline SVG（`<svg>` 直接輸出在 HTML 裡）。
- 互動：**v1 tooltip 僅使用每個 SVG 圖形元素內的 `<title>`**（hover 由瀏覽器原生顯示）。不實作定位 tooltip div、不追求自訂樣式。圖表元素須含可讀 `aria-label` 或 `<title>`；空資料不產生假 tooltip。
- 瀏覽器原生 `<title>` 在觸控裝置不保證顯示，故圖表本身保留可見軸標籤與文字洞察，tooltip 只是輔助。

### 4.3 SVG 渲染方式

- `lib/charts.ts` 是**唯一**的 SVG 產生來源：回傳純 SVG markup 字串（含 `<title>`/`aria-label` 等內容），SSG 與 client 共用同一份。
- `charts.ts` 接受 `{ data, xLabel, yLabel, color }` 與計算層（§3.2）的輸出，回傳完整 `<svg>…</svg>` 字串。
- Astro 子元件（`components/charts/*.astro`）僅做薄包裝：SSG 時把 `charts.ts` 的字串輸出塞進面板。
- **XML escaping 強制**：所有進入 SVG/XML attribute、`<title>`、文字節點的資料（系列標題、組別名稱等外部資料）**必須做 XML escaping**（`& < > " '`），不可直接插入未 escaping 的字串。這是 XSS / markup 正確性要求（與 Dashboard 的 `textContent only` 同一精神）。
- 用 `preserveAspectRatio` + `viewBox`，寬度 100%、高度固定，RWD 縮放。
- 顏色用 design-system tokens（`var(--accent)` 等），light/dark 自動。
- **觀看分佈用分桶長條圖（bucket bar），不建立泛用 LineChart** — 計算層輸出的是分桶分佈，長條圖正確傳達離散桶語意；折線會暗示桶間連續數值關係。

### 4.4 Client-side 重繪（年切換）

- `Insights.astro` 的純函式計算層（§3.2）+ SVG 產生邏輯需可在 client 重跑：`lib/insights.ts`（計算）+ `lib/charts.ts`（回傳 SVG 字串）是 SSG 與 client 共用的同一份程式碼。
- client-side 以 **text/template 方式更新受信任的本地產生 markup**：`fetch` 年度資料 → 重算 `insights.ts` → `charts.ts` 產生各面板 SVG 字串 → 以 `textContent`/innerHTML 於受信任容器更新。外部資料（系列標題、組別名）在 `charts.ts` 內已 XML escaping。
- 年切換流程：`fetch` 年度資料 → 重算 → 重建各面板 SVG → 更新洞察句 → `replaceState('?year=N')`。
- 沿用 Dashboard 的 **fetchToken 防競態**（stale response 捨棄），避免快速切換年度時舊請求覆蓋新資料。
- 失敗（`!res.ok`）：保留現有畫面，不重繪。

## 5. History snapshot（方向 5 基礎）

### 5.1 檔案

```
data/history/{year}/{YYYY-MM-DD}.json
```

- 與 `{year}.json` **相同結構**（`YearData`），一次寫入，內容為當日最後一次 scrape 的全量資料。
- 檔名日期 = `updatedAt` 的臺北日期（`taipeiTimestamp` 的日期部分）。
- 舊檔覆寫（同一天多次 scrape 只留最後一次）。

### 5.2 寫入時機（scrape.ts 改動）

在 **CLI 流程取得 `collectYears` 的 `succeeded` 之後、呼叫 `stageWrites` 之前**，逐一為成功年度寫入 history snapshot：

1. 對每個成功年度，算出 `historyPath = data/history/{year}/{date}.json`。
2. 若該檔已存在且內容相同（hash 比對），跳過不寫（避免無變更 commit）。
3. 否則寫入（與 `{year}.json` 同目錄階層，`mkdir -p`）。

**語意定義**：history snapshot 代表「一次成功完成並回傳的 scrape 結果」，與主檔 atomic commit 協議**不綁定**：

- `runScrape` 成功 → history 寫入；**即使**隨後 `stageWrites`/`commitWrites` 失敗（主檔未更新），history 仍保留 — 因為它忠實記錄了那次成功抓取的資料。
- history 寫入失敗 → 僅 `console.error`，**不阻止**主檔 commit（`{year}.json` 照常寫出）。
- **不影響**現有 atomic commit 協議：`stageWrites`/`commitWrites` 只處理 `{year}.json` + `meta.json`；history 快照獨立寫入，不在 rollback 範圍。

**臺北日期**：快照檔名日期取自 `updatedAt` 的**臺北時區日期**（`taipeiTimestamp` 的日期部分），不得使用 runner 的 local timezone。測試固定：

```
2026-08-06 00:30:00+08:00 → 2026-08-06
2026-08-05 23:30:00+08:00 → 2026-08-05
```

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
  - `titleKeywordStats`：字典比對、計數單位（**每個系列標題最多 1 次**）、大小寫正規化、排除規則（純標點/純數字/長度 1 中文/停用詞）、排序與 tie-breaker、空標題。驗證只分析 `Series.title`（不混入 description/article title）。
- **History 寫入**（`scripts/scrape.test.ts` 擴充）：mock 檔案系統驗證「同日覆寫 / 不同日新增 / 相同內容跳過」；臺北日期測試（`2026-08-06 00:30:00+08:00 → 2026-08-06`、`2026-08-05 23:30:00+08:00 → 2026-08-05`）。
- 不測 SVG 渲染（Astro 元件層，靠手動視覺驗證）。

## 8. 效能

- **初始年度由 SSG 預先計算**（圖表在 HTML 內，首載無 client 計算）；**切換年度時才由 client-side 重算**（§4.4）。
- 計算層 O(n) 一次遍歷，428 篇文章 / 127 系列量級可忽略。
- History 快照每 10 分鐘一次全量寫入（~274KB/次，commit 前去重）。

## 9. Acceptance Criteria

1. `/insights/` 頁可達，header 有連結。
2. 四個面板（發文行為/人氣結構/組別分析/文字分析）皆有 SSG SVG 圖表 + 自動洞察句。
3. 桌面瀏覽器 hover 時由 SVG `<title>` 提供原生提示；圖表本身保留可見軸標籤與文字洞察。
4. 年切換 client-side 運作：切年度 fetch 年度資料重繪，`?year=N` 同步到網址列；無效年度 fallback 到 `latestYear`。
5. 無資料年度顯示空狀態，不 crash。兩情形須明確區分：
   - `/data/{year}.json` **不存在**（如 meta.years 有但檔案缺失）：顯示「此年度尚無資料」，年切換器不列出。
   - 檔案存在但 articles/series 為空：顯示空狀態面板，年切換器仍列出（保留舊檔年度）。
6. `data/history/2026/2026-08-06.json` 在下次 scrape 後存在，結構與 `2026.json` 相同。
7. 同日多次 scrape 只留最後一次快照；無變更不 commit。
8. 現有功能（Dashboard、年切換、收藏、搜尋）不 regression。
