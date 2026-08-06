# Design: 多年度支援 + scrapeLog 錯誤提示（Roadmap Near-term）

> Status: Approved 2026-08-06（brainstorming 流程）。Rev 2 依 code review 修訂（P1 ×3、P2 ×5、P3 ×1）。
> Follows the competition-board design system（`DESIGN.md`）。
> Scope: PRODUCT.md roadmap near-term 第 1、3 項（第 2 項「今日發文」已於 2026-08-05 daily-status spec 完成）。

## Problem

- PRODUCT.md near-term 第 1 項：**multi-year support** 未做。`data/2026.json` 已 year-named、`config/series-manifest.json` 是 per-year 單一來源，但 scraper CLI 只處理單一年度（manifest 是單一物件、寫死 `data/{year}.json` 一支），UI 無年度切換器。架構留了空間，未接上。
- near-term 第 3 項：**scrapeLog 從未顯示**。`runScrape` 已把每系列失敗寫入 `YearData.scrapeLog: string[]`（格式 `"{seriesId}: {message}"`），但 UI 完全沒有呈現。抓取靜默失敗時使用者無從得知資料缺漏。

## Goal

1. 多年度：scraper CLI 支援 manifest 內所有年度，逐一產出 `data/{year}.json`；UI 提供年度切換器，切換即重渲染（組別篩選、排序、統計全隨年度資料走）。目前只有 2026 一年，切換器先就位（單一選項），2027 起自動出現。
2. scrapeLog：status-bar 角落顯示「N 支系列本次抓取失敗」notice，可展開錯誤清單。資料無失敗時視覺隱藏（`hidden`），但有固定 DOM 容器供 client 動態更新。

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

`scripts/types.ts`：`Manifest` 保持「單一年度 entry」型別（`runScrape(manifest: Manifest)` 簽名不變）；新增 `MetaJson`：

```ts
export type Manifest = { year: number; signupListUrl: string }; // per-year entry
export type MetaJson = {
  latestYear: number;   // years[0]（成功年度 desc 的第一個 = 最新）
  years: number[];      // 成功寫檔年度 desc 排序 —— UI 年度選項的唯一權威來源
  updatedAt: string;    // latestYear 年度資料的 updatedAt
  seriesCount: number;  // latestYear 年度資料的 seriesCount
};
```

### 1.2 Scraper CLI（`scripts/scrape.ts` `import.meta.main`）— per-year 隔離 + atomic

- 讀 manifest 陣列 → 依序對每個年度 `runScrape(m)`。
- **Per-year try/catch**：`runScrape(m)` rejection（例：signup list fetch 全數失敗 throw）**與** `series.length === 0` 都算該年度失敗。失敗記錄 `console.error("[year] ...")` 後**繼續下一年度**，不中斷。
- **Atomic write（先算後寫）**：全部年度結果先留在 memory：
  - 成功年度（有資料）→ 準備寫檔。
  - 至少一年成功 → 一次寫出全部成功年度 `data/{year}.json` + `meta.json`，exit 0。
  - **全部失敗 → 完全不寫任何檔案**（既有 `data/*.json` 與 `meta.json` 原樣保留），exit 1。
- `meta.json` 內容：`{ latestYear, years, updatedAt, seriesCount }`，`years` = 本次成功年度 desc、`latestYear = years[0]`、`updatedAt`/`seriesCount` = `latestYear` 對應資料的值。
- 語意註記：**空資料年度保留既有 `{year}.json` 不覆寫**；但該年度不在本次 `meta.years`（選項縮小，見 §1.4）。
- `runScrape` 本身、`mergeCardsAndStats`、各 parser **零變動**。

### 1.3 Build 端（`web/scripts/copy-data.mjs`）

- 目前只 copy `data/2026.json` → 改為 copy `data/` 下所有 `^\d{4}\.json$` 檔。
- **clean 後 copy**：先 `rm` 掉 `web/public/data/` 下所有 `^\d{4}\.json$` 檔，再 copy 來源全部年度檔——確保 source 移除年度後 output 不殘留 stale 檔。`meta.json` 不 copy 到 public（client 不需要）。

### 1.4 頁面（`web/src/pages/index.astro`）

- `import.meta.glob("../../../data/*.json", { eager: true, import: "default" })` → 過濾 `^\d{4}\.json$` → 得到 `dataByYear: Map<number, YearData>`。
- `import.meta.glob("../../../data/meta.json", { eager: true, import: "default" })` → `meta`（build 期）。
- **`years` = `meta.years`（唯一權威）**，並與 `dataByYear` 現有 key 取交集（防禦：資料檔被刪而 meta 未更新的不一致；正常 pipeline 兩者由同一 atomic write 產出，恆一致）；`latestYear = years[0]`；初始資料 `data = dataByYear.get(latestYear)!`。
- `<title>` 改為 `鐵人觀察家 ${latestYear}`。
- **移除** `index.astro` 內的 60s refresh `<script>` 與 `ironman-data` CustomEvent——資料狀態（currentYear）集中到 Dashboard script 管理（見 1.5），refresh 移入 Dashboard。Dashboard 的 `window.IRONMAN_DATA` inline embed 保留為初始渲染來源。

### 1.5 Dashboard 年度切換器（`web/src/components/Dashboard.astro`）

- Props 增加 `years: number[]`（Astro 側從 `meta.years` 傳入）。
- Header `header-actions` 最左新增 `<select id="year-select" class="sort-select" aria-label="切換年度">`，選項 = `years` desc（`<option value="2026">2026 年</option>`）。
- Brand `brand-year` span 加 `id="brand-year"`：`render(data)` 時以 `data.year` 更新其文字。
- **Client script 變更**：
  - `let currentYear: number`（初始 = 初始資料 `data.year`）。
  - `render(data)`：更新 `currentYear = data.year`、**`#year-select.value = String(data.year)`**、`brand-year`、`series-count`/`total-count`、`updated-at`、scrapeLog notice（見 §2）；**`data.year !== 上次 render 的年份`時**重建組別 filter chips（見 1.6）。非年度切換的 refresh 路徑不重建 filter。
  - `#year-select` change → `loadYear(year)`（見 1.7）。
  - 60s refresh 移入本 script：`setInterval(loadYear(currentYear), 60000)`（使用 `currentYear` 變數，change handler 同步更新）。既有 `humanizeAll` 60s 週期保留為獨立 interval。

### 1.6 組別 filter 重建 + 事件委派

- 現況：filter buttons 是 SSR 靜態 markup，client `querySelectorAll(".filter-btn").forEach(addEventListener)` 只在載入時綁一次；切年度重建 buttons 會失綁。
- 改為**容器事件委派**：`#group-filters` 單一 `click` listener，`e.target.closest(".filter-btn")` 處理。SSR 與重建 buttons 共用，不需重綁。
- 年度切換時重建 chips：`renderFilters(groups: string[], counts, activeGroup)` — `createElement` + `textContent`（組別名是爬蟲資料，禁 innerHTML），active 重置為「全部」。
- `applyFilter` 的 active 讀取（`document.querySelector(".filter-btn[data-active='true']")`）不變，對重建後 buttons 同樣有效。

### 1.7 Client fetch 路徑 + request ownership

- 初始渲染：SSR embed（`IRONMAN_DATA`）。
- `loadYear(year: number)`：`fetch(\`/data/${year}.json?t=${Date.now()}\`, { cache: "no-store" })` → JSON → `render(fresh)`。
- **Stale response 防護（request token）**：
  - 模組級 `let fetchToken = 0`。
  - 每次 `loadYear` 呼叫 `const token = ++fetchToken`；`render` 只在 `token === fetchToken` 時執行（response 晚到且已發起更新的 request → 丟棄）。
  - `#year-select` change 與 60s refresh 共用 `loadYear`，token 機制自然覆蓋兩者。
- fetch 失敗（非 ok 或 throw）：保留現況畫面與 select 狀態（沿用既有 try/catch 語意）。

## 2. scrapeLog 錯誤提示

- **固定容器（SSR 永遠輸出）**：`status-bar` 內、`已顯示 N / M` 之後：

  ```html
  <details class="scrape-log" id="scrape-log" hidden>
    <summary>⚠ <span id="scrape-log-count">0</span> 支系列本次抓取失敗</summary>
    <ul id="scrape-log-list"></ul>
  </details>
  ```

  - `hidden` 屬性：SSR 依 `data.scrapeLog.length === 0` 決定是否隱藏（「完全隱藏」= 視覺/accessibility hidden，節點永遠存在）。
  - SSR 有錯誤時：`summary` count、`<li>` 列表（Astro 自動 escape）直接填好，不帶 `hidden`。
- **Client `render(data)` 同步更新**：`#scrape-log-count` 文字、清空重建 `#scrape-log-list`（`createElement` + `textContent` only，錯誤訊息可能含 HTML-ish 內容，禁 innerHTML）、`hidden` toggle（`scrapeLog.length === 0` 才 hidden）。60s refresh 後錯誤浮現/消失都即時生效。
- **樣式**：`design-system.css` 新增 `.scrape-log` / `.scrape-log summary` / `.scrape-log ul`（danger-weak 底、danger 字、小字、`--radius`）；`summary` 游標 pointer、`list-style: none`。

## 3. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `config/series-manifest.json` | 單一物件 → 年度陣列 |
| `scripts/types.ts` | 新增 `MetaJson`（`Manifest` 保持 entry 型別） |
| `scripts/scrape.ts` | CLI 改為逐年度：per-year try/catch、atomic write（全失敗零寫入）、meta.json 新形狀 |
| `web/scripts/copy-data.mjs` | clean + glob copy 所有 `^\d{4}\.json$`（不 copy meta.json） |
| `web/src/pages/index.astro` | glob 年度資料 + meta、`<title>` 帶 year、移除 refresh script + CustomEvent |
| `web/src/components/Dashboard.astro` | `years` prop、年度 `<select>`、`brand-year` id、`render()` 同步 year/select/brand/scrapeLog、filter 事件委派 + 年度切換重建、60s refresh + request token、scrapeLog 固定容器 |
| `web/src/styles/design-system.css` | `.scrape-log` 樣式 |
| `scripts/scrape.test.ts` | CLI 邏輯測試（見 §4） |
| `README.md` | 單年度描述改多年度（架構段、本地開發、測試） |
| `PRODUCT.md` | roadmap near-term 1–3 全數標記完成；Stack/Evidence 段的多年度描述更新 |
| `docs/DEPLOYMENT-HANDOFF.md` | 架構/檔案地圖/已知問題的單年度描述更新（追加「多年度」段，載明 meta 語意） |

不改：`runScrape`、各 parser、`fetch-html`、`daily-status.ts`、`SeriesCard.astro`、`data/2026.json` 內容 shape、`.github/workflows/update.yml`（`bun run scripts/scrape.ts` 已覆蓋多年度；`git add data/ web/public/data/` 已涵蓋新年度檔與 meta.json）。

## 4. 測試策略

### 4.1 單元（`scripts/scrape.test.ts`，fixture-based 不打網）

- 一個年度成功、一個年度 `runScrape` throw → 成功年度仍寫出、throw 年度不阻斷（隔離）。
- 一個年度空 series、另一個成功 → 空年度不覆蓋舊檔、meta 只列成功年度。
- 全部年度 throw / 空資料 → exit 1、**meta 與資料檔完全不動**（atomic）。
- `meta.years` 排序 desc、`latestYear = years[0]`、`updatedAt`/`seriesCount` 來源正確。
- 既有 stale 年度檔 + 本次成功年度的 `years` 語意（成功年度才列）。

### 4.2 Build（`web/`）

- 合成 `data/2025.json` + `data/2026.json` + `data/meta.json` + 干擾檔（`foo.json`、`2026.backup.json`）→ build 後 `web/public/data/` 恰好含 `2025.json`、`2026.json`，**不含** meta.json 與干擾檔。
- **stale 清除**：預置 `web/public/data/2024.json` → build → 檔案消失（clean）。

### 4.3 型別與既有測試

- `bunx tsc --noEmit` 全專案乾淨；`bun test` 全綠（既有 18 pass + 新增）。

### 4.4 手動 headless browser

1. 正常載入：年度 select 顯示 2026（單一選項）、filter/sort 正常、scrapeLog notice 隱藏（現況空）。
2. 年度切換：合成 `data/2025.json` + 更新 manifest/meta → build → 切換 2025 確認 filter chips 重建且 click 有效、統計、brand-year、sort 全跟著變 → 切回 2026 → 移除合成檔並 rebuild。
3. **scrapeLog transition**：初始空 → 注入 2 條錯誤於 public JSON → 等 60s refresh → notice 出現、展開顯示錯誤清單、無 XSS → 還原 → refresh → notice 消失。
4. **Race**：DevTools throttling 或重排模擬「2026 refresh response 晚於 2025 切換」→ 畫面停在 2025（token 丟棄舊 response）、select value 一致。
5. 無 console error。

## 5. 風險

- **年度切換與 refresh 的 race**：request token（§1.7）保證只有最新 request 能 render；`#year-select.value` 在 render 中同步，UI 與資料一致。
- **filter 重建丟失使用者狀態**：僅年度切換時重置為「全部」——可接受（年度不同、組別集合可能不同，保留舊組別反而錯）。
- **`import.meta.glob` eager 打包全部年度 JSON**：年度數量極少（每年一支），256KB × N 可接受；SSG 下為 build 期資料，不影響 runtime 成本。
- **manifest 改陣列的向後相容**：唯一讀者是 scraper CLI（同步改）；workflow 無感知。
- **meta 語意**：`years` 是 UI 選項唯一權威；空資料年度保留檔但選項縮小——文件（README/DEPLOYMENT-HANDOFF）一併註明。
- **atomic write**：全失敗零寫入，避免資料檔與 meta 不一致；workflow 見 exit 1 不 commit、舊站繼續服務舊資料。
