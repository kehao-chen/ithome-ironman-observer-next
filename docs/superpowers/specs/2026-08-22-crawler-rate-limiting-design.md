# 爬蟲全域請求平滑節流與 15 分鐘排程設計 (Crawler Rate Limiting & Pacing Design)

## 1. 背景與目標 (Background & Goals)

### 1.1 現況痛點
- **瞬間請求過載 (Burst QPS)**：在增量爬蟲架構下，5 個並行 Worker 同時對 iThome 伺服器發出請求，且系列內部請求（RSS、最後一頁、徽章頁）與報名清單分頁之間無全域間隔。單次爬取在 **10～15 秒內密集發出 500+ 個 HTTP 請求**（瞬間達 **30～50 req/s**），觸發 iThome / CDN 的頻率限制，回傳 **HTTP 429 (Too Many Requests)**。
- **排程頻率**：原先 Cloudflare Worker 設定為每 10 分鐘觸發一次（`*/10 * * * *`）。調降至每 15 分鐘一次（`*/15 * * * *`）可減少每日總請求輪次（144 輪降至 96 輪），並提供更寬裕的單次執行時間窗口。

### 1.2 優化目標
1. **排程間隔調整**：Cloudflare Worker Cron trigger 改為 `*/15 * * * *`（每 15 分鐘一次）。
2. **全域平滑節流 (Global Paced Rate Limiter)**：
   - 全域限制同時間最多 **2 個 in-flight HTTP requests**（`concurrency = 2`）。
   - 全域強制任意兩次 HTTP 請求發送之間至少間隔 **150ms**（`minIntervalMs = 150`），將 QPS 嚴格壓制在 **$\le 5$ req/s** 的安全水位。
3. **HTTP 429 智慧退避與重試**：
   - 遭遇 HTTP 429 時優先解析 `Retry-After` Header（秒數或 HTTP Date）。
   - 若無 Header，採用漸進指數退避（2s, 4s, 8s），最多重試 3 次。
   - 重試期間全域隊列暫停派發新請求，避免其他並行 worker 連續踩雷。
4. **效能與時間預算**：
   - 常態增量爬取（~545 請求）耗時預計約 **65～85 秒**。
   - 包含 Git 提交與 Cloudflare Pages 部署在內，整輪 CI 耗時約 **1.5～2 分鐘**，在 15 分鐘排程內僅佔用 ~12% 時間。

---

## 2. 排程與觸發系統變更 (Scheduling & Trigger Configuration)

### 2.1 Cloudflare Worker (`worker/wrangler.toml`)
```toml
name = "ironman-observer-trigger"
main = "src/index.ts"
compatibility_date = "2026-08-01"

[triggers]
crons = ["*/15 * * * *"]
```

### 2.2 觸發與並行保護機制
- Worker 內的 `hasActiveRun(env)` 保持不變：若 GitHub Actions 上一輪仍在 `queued` 或 `in_progress`，本輪 tick 自動 skip，防止重疊執行。
- GitHub Actions workflow (`scheduled-update.yml` 與 `deep-calibrate.yml`) 的 `concurrency: group: data-update-main` 保持不變，確保單一序列化執行。

---

## 3. 全域平滑節流器設計 (Global Paced Rate Limiter Architecture)

### 3.1 核心模組架構 (`scripts/fetch-html.ts` & `scripts/rate-limiter.ts`)

將請求節流移至最底層的 Fetcher，讓所有網路操作（報名頁分頁、RSS 探測、系列頁最後一頁、徽章頁）一律自動受到全域速率限制。

```ts
export interface PacedFetchOptions {
  concurrency?: number;     // 預設 2
  minIntervalMs?: number;   // 預設 150ms
  retries?: number;         // 預設 3
  fetchFn?: typeof fetch;   // 可注入原生 fetch，便於測試
}

export interface PacedFetcher {
  (url: string, init?: RequestInit): Promise<string>;
  destroy?: () => void;
}
```

### 3.2 節流與隊列運作機制
1. **全域發送間隔 (Minimum Inter-Arrival Delay)**：
   - 維護全域變數 `lastRequestTimestamp`。
   - 每次有 worker 獲准發送請求時，檢查 `Date.now() - lastRequestTimestamp`。若小於 `minIntervalMs`，強制非同步等待補足時間差，更新 `lastRequestTimestamp` 後才發出請求。
2. **全域並行信號量 (Concurrency Semaphore)**：
   - 維護 `activeRequests` 計數器（上限為 `concurrency = 2`）。
   - 超過上限的請求進入等待隊列（FIFO Promise Queue）。
3. **HTTP 429 暫停與重試流程**：
   - 當任一請求收到 `HTTP 429`（或 5xx）：
     1. 解析 Response Header `Retry-After`。若為純數字則轉為秒數；若為日期字串則計算毫秒差；若無 Header 則退回指數退避（`2000 * 2^attempt` ms）。
     2. 觸發**全域暫停 (Global Throttle Pause)**：設定 `pauseUntil = Date.now() + waitMs`，在此期間所有排隊請求均等待至 `pauseUntil` 之後才繼續發送。
     3. 進行重試（最多 `retries = 3` 次）。

---

## 4. 爬蟲主流程調整 (`scripts/scrape.ts`)

### 4.1 移除粗粒度 Delay，改由全域 Fetcher 統籌
- `runScrape` 預設 concurrency 由 5 改為 2。
- 移除 `pMap` 中僅在系列結束後等待的 `delayMs: 20`。
- `signupListUrl` 遍歷、`scrapeSeriesIncremental`、`scrapeSeriesFull`、`officialDayCount` 統一注入同一實例的 `PacedFetcher`。

---

## 5. 測試與驗證規劃 (Testing & Verification Plan)

### 5.1 單元測試
1. **`scripts/rate-limiter.test.ts` / `scripts/fetch-html.test.ts`**：
   - 驗證 `concurrency: 2` 下同時間在途請求數不超過 2。
   - 驗證連續 N 個請求之間，每次發出時間差均 $\ge 150$ms。
   - 驗證遇到 HTTP 429 時能正確讀取 `Retry-After` Header 並暫停隊列後重試成功。
   - 驗證重試達最大上限後正確拋出錯誤。
2. **`scripts/scrape.test.ts` & `scripts/scrape-cli.test.ts`**：
   - 驗證整個爬蟲流程在注入 mock paced fetcher 下正常運作。
   - 確保現有 297 個測試全部維持通過。

### 5.2 驗證指標
- 執行 `bun test` 全數通過。
- 模擬 100 個連線請求時，監測 QPS 嚴格保持在 4～6 req/s 之間，無任何突發 Burst。
