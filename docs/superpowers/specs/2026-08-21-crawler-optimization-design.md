# 爬蟲效能優化與雙模式增量同步設計 (v4 最終定稿版)

## 1. 目標與背景

### 現況痛點
- **CI 耗時長**：原爬蟲採單執行緒序列爬取 263 個系列，每輪需耗費 **3.5 ~ 4.5 分鐘**。
- **請求量過大**：每 10 分鐘全量爬取（報名頁、每個系列 RSS、系列頁 1~3 頁、最新文章頁），單次產生 **1,100 ~ 1,200 個 HTTP 請求**（每日約 15 萬次），對 iThome 伺服器造成不必要的負載。
- **重複抓取舊資料**：98% 以上的系列在 10 分鐘內未發新文，卻持續重複下載歷史分頁與最新文章頁 HTML。
- **iThome 分頁機制特性**：系列頁第 1 頁為最舊 10 篇（Day 0~9），最新文章位於最後一頁（`?page=Math.ceil(N / 10)`）。

### 優化目標與請求量基準公式 (Parameterized Request Baseline)
常態增量爬取的請求數計算公式：
$$R_{\text{inc}} = N_{\text{signup\_pages}} + \sum_{s \in \text{series}} (1_{\text{RSS}} + 1_{\text{last\_page}} + 1_{\text{badge\_if\_new}})$$

以目前 $S \approx 263$ 個系列、報名頁 14 頁、單輪約 5 個系列有新發文為例：
$$R_{\text{inc}} \approx 14 + (263 \times 2) + 5 \approx \mathbf{545 \text{ 請求}}$$
相較於既有全量爬取的基準公式：
$$R_{\text{legacy}} = N_{\text{signup\_pages}} + \sum_{s \in \text{series}} (1_{\text{RSS}} + \text{pages}_s + 1_{\text{badge}}) \approx 14 + 263 \times (1 + 2 + 1) \approx \mathbf{1,066 \text{ 請求}}$$
- **請求數減少**：減少約 **50% ~ 55%** 的 HTTP 連線，且消除 95%+ 系列的最新文章頁與深層分頁下載。
- **CI 耗時目標**：常態每 10 分鐘增量爬蟲時間目標降至 **< 30 秒**（p95 < 45 秒，透過 5 並行 worker 消除序列 I/O 阻塞）。
- **資料一致性保證**：最新文章互動數據每 10 分鐘即時更新；歷史文章透過嚴格的 ID 集合與分頁校準驗證，不符安全條件時一律退回 Full Fallback。

---

## 2. 資料權威來源與狀態模型 (Data Authority & State Model)

### 2.1 權威來源階層 (Authority Hierarchy)
1. **文章篇數 (`articleCount`)**：以系列頁標頭 `<span>共 N 篇文章</span>` 為唯一權威值。RSS `items.length` 僅作為定位最後一頁的探測提示（Hint $N_{\text{hint}}$）。
2. **官方參賽天數 (`dayCount`)**：以最新文章頁 `ir-article__days-num` 徽章與系列頁標頭取 `Math.max` 為權威值（官方 streak）。若無新發文且快取有效，直接復用快取 `prev.dayCount`。
3. **更新時間 (`lastUpdated`)**：
   - 優先：RSS `<lastBuildDate>`。
   - 保底：若 RSS 失敗或無 `lastBuildDate`，使用最新文章的 `publishedAt`。
   - 未開賽（0 篇）：`null`。
   - `stale` 狀態：維持快取的 `prev.lastUpdated`。

### 2.2 系列爬取狀態模型 (Series Result Status)
單一系列爬取結果明確定義為三種狀態，禁止將失敗偽裝成成功：

```ts
export type SeriesResult =
  | { status: "fresh"; series: Series }
  | { status: "stale"; series: Series; error: string }
  | { status: "failed"; seriesId: number; error: string };
```

#### 彙整至 `YearData` 與 `scrapeLog` 規則：
- **`fresh`**：放入 `YearData.series`。
- **`stale`**：將快取 `series` 放入 `YearData.series`，同時在 `YearData.scrapeLog` 寫入 `[stale] ${seriesId}: ${error}` 警告。
- **`failed`**：**絕不放入 `YearData.series`**（徹底修正既有程式在無 stats 時製造假 0 篇系列的行為），在 `YearData.scrapeLog` 寫入 `[failed] ${seriesId}: ${error}`，並累計至回傳的 `failures` 陣列。
- **全部失敗保護**：若 `YearData.series.length === 0`，觸發全失敗防護（終止原子寫入，保留前次資料）。

---

## 3. 雙模式爬蟲體系 (Dual-Mode Architecture)

### 3.1 模式 A：日常增量模式 (Incremental Sync，預設)

#### 核心流程圖
```mermaid
flowchart TD
    Start[開始處理系列] --> LoadCache[讀取快取 prev = cachedMap.get id]
    LoadCache --> FetchRSS[抓取 RSS 探測]
    FetchRSS --> RSSSuccess{RSS 成功 ?}
    
    %% RSS 失敗分支
    RSSSuccess -- 否 --> FullFallback[走完整系列分頁 Full Fallback]
    
    %% RSS 成功分支
    RSSSuccess -- 是 --> CheckNHint{RSS items.length === 0 ?}
    
    %% RSS 0 篇保護
    CheckNHint -- 是 (N=0) --> CheckPrevEmpty{prev 是否有文章 ?}
    CheckPrevEmpty -- prev.articleCount > 0 --> FullFallback
    CheckPrevEmpty -- 無快取/無文章 --> VerifyEmpty[抓取系列第 1 頁驗證]
    VerifyEmpty --> IsTrulyEmpty{第 1 頁 articleCount === 0 ?}
    IsTrulyEmpty -- 是 --> EmitPending[輸出 0 篇未開賽 fresh 系列]
    IsTrulyEmpty -- 否 --> FullFallback
    
    %% RSS > 0 篇
    CheckNHint -- 否 (N > 0) --> CalcLastPage["計算 lastPage = Math.ceil(N / 10)"]
    CalcLastPage --> FetchLastPage["抓取系列最後一頁 ?page=lastPage"]
    FetchLastPage --> ValidatePage{isSeriesPage HTML 有效 ?}
    
    ValidatePage -- 無效/反爬/500 --> HandleFetchFail{是否有快取 prev ?}
    HandleFetchFail -- 是 --> EmitStale[記錄 scrapeLog, 輸出 stale 快取]
    HandleFetchFail -- 否 --> EmitFailed[記錄 scrapeLog, 標記 failed]
    
    ValidatePage -- 有效 --> ParseLastPage[解析 Header 數據與最後一頁文章]
    ParseLastPage --> VerifyLastPageMatch{"lastPage 是否吻合 Math.ceil(header.articleCount / 10) ?"}
    VerifyLastPageMatch -- 不吻合 (RSS hint 失準) --> FullFallback
    
    VerifyLastPageMatch -- 吻合 (正確最後一頁) --> CheckIncrementalSafe{安全增量條件是否滿足 ?}
    CheckIncrementalSafe -- 否 (篇數減少/前綴不符/跨多頁) --> FullFallback
    CheckIncrementalSafe -- 是 (安全增量) --> MergeID[以 Article ID 映射替換最後一頁數據]
    
    MergeID --> VerifyMergedLength{merged.length === header.articleCount 且 ID 無重複 ?}
    VerifyMergedLength -- 不符 --> FullFallback
    VerifyMergedLength -- 完全相符 --> HasNewPost{header.articleCount > prev.articleCount ?}
    
    HasNewPost -- 無新發文 (篇數相同) --> ReuseDay[復用 prev.dayCount, 跳過文章頁]
    HasNewPost -- 有新發文 --> FetchBadge[抓取最新文章頁 HTML 計算 officialDayCount]
    
    ReuseDay --> FreshDone[輸出 fresh 結果]
    FetchBadge --> FreshDone
    FullFallback --> FullDone[完成 Full Fallback 解析]
```

#### 3.1.1 嚴格的安全增量條件（Safety Invariants）
當且僅當滿足以下**所有**條件時，才執行增量合併；任何一項不符合一律轉入 **Full Fallback**：
1. **快取完整性**：`prev && prev.articles.length === prev.articleCount && prev.articleCount > 0`。
2. **單調非遞減（禁止刪文時增量）**：`header.articleCount >= prev.articleCount`（若篇數減少，代表文章被刪除，必須走 Full Fallback 重新同步）。
3. **最後一頁校準**：`lastPage === Math.ceil(header.articleCount / 10)`（證明所抓取的確實是系列真正的最後一頁）。
4. **無大幅跨頁增長**：`lastPage - Math.ceil(prev.articleCount / 10) <= 1`（一次發文未跨超過 1 頁，保證快取已涵蓋前 $\text{lastPage} - 1$ 頁的所有文章）。
5. **可執行前綴驗證與合併**：
   - 提取前段快取文章：`prefixArticles = prev.articles.slice(0, (lastPage - 1) * 10)`。
   - 驗證前綴長度：`prefixArticles.length === (lastPage - 1) * 10`。
   - ID 映射合併：以 `prefixArticles` 與 `lastPageArticles` 依 `id` 建立 Map 替換或附加。
   - 驗證合併後文章數：`mergedArticles.length === header.articleCount` 且 ID 集合完全無重複。

---

### 3.2 Full Fallback 完整規範與完成條件
當系列需要 Full Fallback 或處於全量深度校準模式（`--full`）時：
1. **逐頁遍歷抓取**：
   - 從第 1 頁開始，依 `nextPage` 依序抓取所有分頁（`?page=1` $\dots$ `?page=M`）。
   - 每個分頁必須通過 `isSeriesPage` 驗證。
   - 第 1 頁提供權威標頭數據：`headerDayCount`, `articleCount`, `subscriptions`。
2. **完成條件（Completion Invariant）**：
   - 遍歷結束後，收集的文章清單必須滿足：`articles.length === header.articleCount` 且所有文章 `id` 唯一。
   - 若分頁遍歷完成後篇數仍不符或中途分頁失敗：
     - 若有快取 $\rightarrow$ 輸出 `stale` 並在 `scrapeLog` 記錄錯誤。
     - 若無快取 $\rightarrow$ 輸出 `failed`，不製造殘缺資料。
3. **最新文章徽章計算**：
   - 若 `articles.length > 0`，抓取最新文章頁 HTML 呼叫 `officialDayCount`。
   - 若最新文章頁抓取或解析失敗，自動退回第 1 頁標頭天數 `headerDayCount` 保底（非致命降級，依然輸出 `fresh`，並在 `scrapeLog` 記錄 warning）。
4. **排序與輸出**：維持既有資料契約 `articles.sort((a, b) => a.day - b.day)`。

---

## 4. 頁面有效性驗證 (Page Validity Invariants)

```ts
export function isSeriesPage(html: string): boolean {
  // 必須包含系列頁標頭特徵（支援 0 篇未開賽系列與正常系列）
  const hasHeader = /參賽天數\s*\d+\s*天/.test(html) && /共\s*\d+\s*篇文章/.test(html);
  const hasContainer = html.includes('qa-list__info') || html.includes('profile-main') || html.includes('ir-profile-list');
  return hasHeader && hasContainer;
}

export function isArticlePage(html: string): boolean {
  // 必須包含文章頁標籤或問答特徵
  return html.includes('ir-article') || html.includes('qa-markdown');
}
```

---

## 5. 並行架構與請求節流 (Concurrency & Rate Limiting)

### 5.1 Series-Level Concurrency（系列級並行）
- 同一時間最多 **5 個系列** 進入處理流程（Worker Pool Concurrency = 5）。

### 5.2 Request-Level Rate Limiter（全域請求節流）
- 全域限制同時間最多 **5 個 in-flight HTTP requests**。
- 每個 HTTP 請求發送之間加入 **Host-Wide Minimum Interval（20ms）** 平滑流量。
- 重試（Retry）機制：遇到 HTTP 429/5xx 或網路中斷時，透過指數退避（1s, 2s, 4s）重試最多 3 次，重試請求同樣受全域 Rate Limiter 管控。
- 僅對 `!res.ok`（非 2xx 狀態碼）進行重試。

---

## 6. GitHub Actions 工作流程與競態防護 (Workflow & Concurrency Group)

### 6.1 共用 Concurrency Group 防護
`scheduled-update.yml` 與新增的 `deep-calibrate.yml` 統一共用相同的 concurrency group：
```yaml
concurrency:
  group: data-update-main
  cancel-in-progress: false
```

### 6.2 完整 Workflow Step Contract

#### `scheduled-update.yml`（每 10 分鐘一次，Worker 觸發）
```yaml
name: scheduled-update
on:
  workflow_dispatch: {}

concurrency:
  group: data-update-main
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - name: Scrape (Incremental)
        run: bun run scripts/scrape.ts
      - name: Commit data if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/ web/public/data/
          if git diff --cached --quiet; then
            echo "no data change; skipping commit+build+deploy"
            exit 0
          fi
          git commit -m "chore: update ironman data $(date -u +%Y-%m-%dT%H:%MZ)"
          for attempt in 1 2 3 4 5; do
            if git pull --rebase origin main && git push origin main; then
              exit 0
            fi
            sleep 5
          done
          echo "push failed after rebase retries" >&2
          exit 1
      - name: Build site
        run: cd web && bun install && bun run build
      - name: Deploy to Cloudflare Pages
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler pages deploy web/dist --project-name=ironman-observer-next
```

#### `deep-calibrate.yml`（每 2 小時定時 / 手動觸發）
```yaml
name: deep-calibrate
on:
  schedule:
    - cron: "15 */2 * * *"
  workflow_dispatch: {}

concurrency:
  group: data-update-main
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  calibrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - name: Scrape (Full Calibration)
        run: bun run scripts/scrape.ts --full
      - name: Commit data if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/ web/public/data/
          if git diff --cached --quiet; then
            echo "no data change; skipping commit+build+deploy"
            exit 0
          fi
          git commit -m "chore: deep calibrate ironman data $(date -u +%Y-%m-%dT%H:%MZ)"
          for attempt in 1 2 3 4 5; do
            if git pull --rebase origin main && git push origin main; then
              exit 0
            fi
            sleep 5
          done
          echo "push failed after rebase retries" >&2
          exit 1
      - name: Build site
        run: cd web && bun install && bun run build
      - name: Deploy to Cloudflare Pages
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler pages deploy web/dist --project-name=ironman-observer-next
```

---

## 7. 測試與驗證規劃 (Testing Strategy)

### 單元測試覆蓋清單 (`scripts/scrape.test.ts`, `scripts/parse-series.test.ts`)
1. **最後一頁計算與校準**：
   - $N=0 \rightarrow 0$, $N=7 \rightarrow 1$, $N=10 \rightarrow 1$, $N=11 \rightarrow 2$, $N=21 \rightarrow 3$。
2. **Page Boundary Shift（分頁位移合併）**：
   - $9 \rightarrow 10$（同頁增長）
   - $10 \rightarrow 11$（跨入新分頁）
   - $19 \rightarrow 20$（分頁補滿）
   - $20 \rightarrow 21$（跨入第 3 頁）
   - 一次增加超過 10 篇（跨頁躍升，驗證觸發 Full Fallback）
   - 篇數減少（作者刪文，驗證觸發 Full Fallback）
3. **ID 集合一致性檢查**：
   - 快取文章 ID 前綴一致且合併後總數相符 $\rightarrow$ 增量合併成功。
   - 合併後出現重複 ID 或總數不符 $\rightarrow$ 拒絕增量合併，觸發 Full Fallback。
4. **狀態模型與錯誤處理 (`SeriesResult`)**：
   - RSS 失敗但有快取 $\rightarrow$ 走 Full Fallback；若 Full 也失敗 $\rightarrow$ 輸出 `stale` 並記錄 `scrapeLog`。
   - RSS 失敗且無快取 $\rightarrow$ 走 Full Fallback；若 Full 也失敗 $\rightarrow$ 輸出 `failed`，不產生偽造空系列。
   - RSS 回傳 0 篇但快取有文章 $\rightarrow$ 觸發 Full Fallback 驗證，不直接清空。
   - 最後一頁抓取失敗且 RSS 偵測到新文章 $\rightarrow$ 輸出 `stale` 並記錄警告。
   - 頁面驗證：Challenge / 錯誤 HTML $\rightarrow$ `isSeriesPage` 回傳 `false`，觸發異常保護。
5. **等價性驗證 (Equivalence Test)**：
   - 相同網路回傳下，`runIncrementalScrape` 與 `runFullScrape` 產出的 `Series` 物件在資料結構與欄位值上完全等價。
6. **Rate Limiter & Worker Pool 測試**：
   - 驗證同時間 in-flight 請求數不超過限制，且所有任務正常完成。
