# 爬蟲全域請求平滑節流與 15 分鐘排程實作計畫 (Crawler Rate Limiting Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將爬蟲排程間隔由 10 分鐘調整為 15 分鐘，並實作全域請求平滑節流器（限制全域並行 2、全域請求間隔 150ms、HTTP 429 退避與隊列暫停），徹底解決 iThome HTTP 429 頻率限制問題。

**Architecture:** 在最底層的 Fetcher 層封裝 Paced Queue，提供全域 Inter-arrival 間隔計時、全域並行信號量控制、以及 429 `Retry-After` Header 解析與動態暫停隊列機制；上層爬蟲管線與 Worker 排程調整為 15 分鐘與 2 並行。

**Tech Stack:** TypeScript, Bun, Bun Test, Cloudflare Workers, GitHub Actions.

## Global Constraints
- **全域並行數 (Global Concurrency)**: 預設上限為 2。
- **全域請求間隔 (Global Min Interval)**: 任意兩次發送請求間隔至少 150ms（QPS $\le 5$ req/s）。
- **HTTP 429 退避**: 解析 `Retry-After` header（秒數或 HTTP Date），無 Header 時使用指數退避（2s, 4s, 8s），重試上限 3 次。
- **無損相容性**: 現有 297 個單元測試必須全部維持通過。

---

### Task 1: 更新排程觸發設定為 15 分鐘 (Trigger Configuration)

**Files:**
- Modify: `worker/wrangler.toml:1-6`
- Modify: `worker/src/index.ts:1-15`
- Modify: `.github/workflows/scheduled-update.yml:1-7`

**Interfaces:**
- Consumes: Cloudflare Worker cron syntax (`*/15 * * * *`)
- Produces: 15-minute cron schedule for Cloudflare Workers trigger

- [ ] **Step 1: 修改 worker/wrangler.toml**
將 `crons = ["*/10 * * * *"]` 改為 `crons = ["*/15 * * * *"]`。

- [ ] **Step 2: 修改 worker/src/index.ts 與 .github/workflows/scheduled-update.yml 註解**
更新相關註解從 10 分鐘改為 15 分鐘。

- [ ] **Step 3: 驗證設定**
確認 `worker/wrangler.toml` 格式正確無誤。

- [ ] **Step 4: Commit**
```bash
git add worker/wrangler.toml worker/src/index.ts .github/workflows/scheduled-update.yml
git commit -m "chore: update scheduled trigger interval to 15 minutes"
```

---

### Task 2: 實作全域平滑節流器與 429 退避機制 (Paced Rate Limiter)

**Files:**
- Modify: `scripts/rate-limiter.ts`
- Modify: `scripts/rate-limiter.test.ts`

**Interfaces:**
- Consumes: Native `fetch` or injected fetch function
- Produces: `createPacedFetcher(options?: PacedFetchOptions): PacedFetcher`
  ```ts
  export interface PacedFetchOptions {
    concurrency?: number;     // default 2
    minIntervalMs?: number;   // default 150
    retries?: number;         // default 3
    fetchFn?: typeof fetch;
  }
  export type PacedFetcher = (url: string, init?: RequestInit) => Promise<Response>;
  ```

- [ ] **Step 1: 撰寫 Paced Rate Limiter 失敗測試**
在 `scripts/rate-limiter.test.ts` 中加入：
1. 測試 `concurrency: 2` 下同時間 in-flight 請求數不大於 2。
2. 測試請求發出時間間隔至少 `minIntervalMs` (例如 50ms 測試環境)。
3. 測試遇到 HTTP 429 時讀取 `Retry-After` Header，全域隊列暫停並重試成功。
4. 測試無 `Retry-After` 時的指數退避重試與失敗拋出。

- [ ] **Step 2: 執行測試確認失敗**
```bash
bun test scripts/rate-limiter.test.ts
```

- [ ] **Step 3: 在 scripts/rate-limiter.ts 實作 createPacedFetcher**
實作隊列管理、`activeCount`、`lastRequestTime` 最小間隔延遲、`pauseUntil` 全域 429 暫停、以及重試邏輯。

- [ ] **Step 4: 執行測試確認通過**
```bash
bun test scripts/rate-limiter.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add scripts/rate-limiter.ts scripts/rate-limiter.test.ts
git commit -m "feat: implement createPacedFetcher with global pacing and 429 backoff"
```

---

### Task 3: 升級 HTML Fetcher 整合全域節流 (Fetch HTML Integration)

**Files:**
- Modify: `scripts/fetch-html.ts`
- Modify: `scripts/fetch-html.test.ts`

**Interfaces:**
- Consumes: `createPacedFetcher` from `scripts/rate-limiter.ts`
- Produces: `fetchHtml(url: string, opts?: FetchHtmlOptions): Promise<string>`
- Produces: `createPacedHtmlFetcher(opts?: PacedFetchOptions): (url: string) => Promise<string>`

- [ ] **Step 1: 撰寫 fetch-html 測試**
在 `scripts/fetch-html.test.ts` 驗證：
1. `fetchHtml` 預設透過全域 paced fetcher 取得 HTML 字串。
2. 可自訂或注入 `createPacedHtmlFetcher` 進行客製化與測試隔離。

- [ ] **Step 2: 執行測試確認失敗**
```bash
bun test scripts/fetch-html.test.ts
```

- [ ] **Step 3: 修改 scripts/fetch-html.ts**
使用 `createPacedFetcher` 封裝預設的 `fetchHtml` 與工廠函數 `createPacedHtmlFetcher`。

- [ ] **Step 4: 執行測試確認通過**
```bash
bun test scripts/fetch-html.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add scripts/fetch-html.ts scripts/fetch-html.test.ts
git commit -m "feat: integrate paced rate limiter into fetchHtml"
```

---

### Task 4: 調整爬蟲管線與預設並行度 (Crawler Pipeline Integration)

**Files:**
- Modify: `scripts/scrape.ts`
- Modify: `scripts/scrape.test.ts`
- Modify: `scripts/scrape-cli.test.ts`

**Interfaces:**
- Consumes: `createPacedHtmlFetcher` and `fetchHtml`
- Produces: `runScrape(manifest, { concurrency: 2, ... })`

- [ ] **Step 1: 檢查與調整 scrape 相關測試**
確保 `scripts/scrape.test.ts` 與 `scripts/scrape-cli.test.ts` 的測試 mock fetcher 正常運作。

- [ ] **Step 2: 修改 scripts/scrape.ts**
1. 將 `runScrape` 的預設 `concurrency` 改為 2。
2. 移除 `pMap` 呼叫中無效的 `delayMs: 20`（已由底層 `fetcher` 統一控制）。
3. 確保 `signupListUrl` 遍歷、`scrapeSeriesIncremental`、`scrapeSeriesFull`、`officialDayCount` 統一共享同一個 `fetcher` 實例。

- [ ] **Step 3: 執行測試確認通過**
```bash
bun test scripts/scrape.test.ts scripts/scrape-cli.test.ts
```

- [ ] **Step 4: Commit**
```bash
git add scripts/scrape.ts scripts/scrape.test.ts scripts/scrape-cli.test.ts
git commit -m "feat: configure scraper concurrency to 2 and unify paced fetcher"
```

---

### Task 5: 完整測試套件驗證 (Full Suite Verification)

**Files:**
- Verify all tests across workspace

- [ ] **Step 1: 執行全部單元測試**
```bash
bun test
```
預期結果：所有 297+ 個測試全數 PASS。

- [ ] **Step 2: 執行乾跑或效能檢查 (Dry Run Check)**
驗證 rate limiter 在大量請求下的時間分佈符合預期（每請求間隔 $\ge 150$ms，並行 $\le 2$）。

- [ ] **Step 3: Commit**
```bash
git commit --allow-empty -m "chore: verify test suite passes with crawler rate limiting"
```
