# 鐵人觀察家 Next — 部署與交接紀錄

> 狀態：**已上線**。本文是 2026-08-05 實作 session 的交接文件，供後續 session（尤其 UI/UX 改版）快速接續。設計與實作細節見 spec 與 plan。

## 現況速覽

| 項目 | 值 |
|---|---|
| 線上站 | https://ithome-ironman-observer.happyhacking.ninja/ |
| 後備網址 | https://ironman-observer-next.pages.dev/ |
| GitHub | https://github.com/kehao-chen/ithome-ironman-observer-next |
| 資料 | 127 支系列 / 17 組別（2026-08-05，報名持續增加中） |
| 排程 | Cloudflare Worker cron 每 10 分鐘 → `workflow_dispatch`（144 次/天；public repo 的 GitHub-hosted runner 免費且不計分鐘） |
| 部署鏈 | 全自動，最後一次手動驗證 run 30978443677 全綠 |

## 架構（已上線，勿破壞契約）

```
ithelp 鐵人賽 (signup 列表 + RSS + series 頁)
   │  browser UA 必帶 (403 否則)
   ▼
Cloudflare Worker ironman-observer-trigger (cron */10)
   │  POST /repos/.../actions/workflows/scheduled-update.yml/dispatches
   ▼
GH Actions (.github/workflows/scheduled-update.yml)
   ├─ bun run scripts/scrape.ts      → data/{year}.json（每年度一支）+ data/meta.json
   ├─ 資料有變才 commit + push       → 無變更 exit 0 跳過
   ├─ cd web && bun install && build → dist/
   └─ npx wrangler pages deploy      → Cloudflare Pages
```

- **零成本**：Cloudflare Workers/Pages free tier + GH Actions public-repo 免費 runner + 自有網域。無後端、無 DB（JSON 即 DB；每年度一支 `data/{year}.json`，`data/meta.json` 的 `years` 是年度選項唯一權威）。
- **每 10 分鐘全量抓取** ~250 requests（127 系列 × 2 + 分頁），約 2.5 min/run。

## 關鍵檔案地圖

| 路徑 | 內容 |
|---|---|
| `scripts/scrape.ts` | orchestrator：讀 `config/series-manifest.json` 陣列，**逐年度**跑 `runScrape`（per-year try/catch；series 為 0 或 throw = 該年度失敗，console.error 後繼續）。**至少一年成功** → 寫出每個成功年度 `data/{year}.json` + `data/meta.json`，exit 0；**全部失敗** → 零寫入（保留舊資料）、exit 1（workflow 因步驟失敗而不 commit，舊站繼續服務舊資料）。`taipeiTimestamp()` 輸出正確臺北時間（曾修過 toISOString 誤標 bug）；`collectYears`/`buildMeta` 為純函式（有測試） |
| `scripts/parse-signup.ts` | signup 列表 HTML → SignupCard（含 `decodeHtmlEntities`，資料必須存純文字） |
| `scripts/parse-rss.ts` | RSS → RssChannel；`parseRfc822` 保留來源 offset 牆鐘（曾修過 UTC 誤標 bug） |
| `scripts/parse-series.ts` | series 頁 → SeriesStats（瀏覽/Like/留言/訂閱） |
| `scripts/html-entities.ts` | 共享 entity 解碼（&amp; 等）——**必須在 parse 時解，否則 Astro/client 雙重跳脫顯示 &amp;amp;** |
| `scripts/types.ts` | 全專案共享型別（scraper + Astro 共用） |
| `web/scripts/copy-data.mjs` | build 前置：清空 `web/public/data/` 所有 `^\d{4}\.json$` → 複製全部 `data/^\d{4}\.json$`；**meta.json 不複製**（client 不需要） |
| `web/src/pages/index.astro` | 頁面：glob `data/*.json`（4 碼年份 key）+ dynamic import meta；`years = meta.years ∩ 實際存在檔案`；`<title>` 隨年度動態 |
| `web/src/components/Dashboard.astro` | **UI/UX 主戰場**：header、**年度切換器**（`#year-select`，以 meta `years` 為權威）、**60s client refresh**（`loadYear` + fetchToken 防 stale race）、group filter（container delegation、僅年度變更時重建 chips）、sort、scrapeLog notice（`<details id="scrape-log">`，空時 hidden）、renderCard（大量 inline style） |
| `web/src/components/SeriesCard.astro` | 靜態卡片（SSG 版）；與 client renderCard 需保持欄位一致 |
| `config/series-manifest.json` | **年度清單（單一來源；陣列）**：`[{ year, signupListUrl }]`，多年度架構從這裡擴 |
| `.github/workflows/scheduled-update.yml` | workflow（僅 `workflow_dispatch`；原 `schedule` 已移除，由 Worker 觸發）；secrets: `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |
| `worker/` | Cloudflare Worker `ironman-observer-trigger`（cron `*/10 * * * *`）：`scheduled()` 打 `workflow_dispatch`，依 `run_number` 去重避免重疊；`GET /` 健康檢查、`POST /dispatch` 手動觸發；secrets: `GITHUB_TOKEN`（Actions:write PAT）、`GITHUB_REPO` |

## 已知問題 / UI/UX 改版候選（新 session 討論起點）

1. **整體視覺**：全 inline style、暗色主題、無設計系統。使用者已表達「UI/UX 整體蠻糟」。
2. **DAY badge 不一致**：static `SeriesCard.astro` 對 `尚未開賽`（dayCount 0）顯示 `DAY ?`，client `renderCard` 顯示 `尚未開賽`。改版時統一（client 渲染會蓋過 static，所以實際使用者看到的是 client 版）。
3. **`尚未開賽` 30 系列**：顯示上只有 badge 差異，卡片其餘欄位（無文章）較空。
4. **filter 按鈕的 placeholder style**：Task 7 遺留 `style="..."`（字面值），一直沒補。改版時自然處理。
5. **更新時間格式**：`updatedAt` 是 `"YYYY-MM-DD HH:mm:ss+08:00"`（空格分隔、無毫秒），`lastUpdated`/`publishedAt` 是 `T` 分隔 ISO。兩者格式不統一（display-only，`<time datetime>` 兩種都吃）。
6. **排序語意**：「最新發布」目前是 `articles` 最後一筆的 `publishedAt`（= 最新 Day）；「最多觀看」是該系列全部文章 views 總和。若有更好的定義（如當日新增文章數）可在改版討論。
7. **群組「ChatGPT & Codex」**：entity 已解碼為正確 `&`，確認 UI 顯示正常即可。
8. **零文章系列 30 支**：`articleCount === 0`（尚未開賽），篩選/排序時會混在最後。

### 多年度（2026-08-06 新增，Task 1–6 實作）

- **meta 語意**：`data/meta.json` = `{ latestYear, years（desc）, updatedAt, seriesCount }`；`years` 是 UI 年度選項的**唯一權威**（index.astro 再與實際存在的 `data/{year}.json` 取交集做防禦）。`seriesCount`/`updatedAt` 屬 latestYear。
- **空資料年度**：某年度抓取失敗但舊檔仍在 → 保留舊 `{year}.json`，但該年度**不寫入 `meta.years`**（buildMeta 只收成功年度）→ UI 選項縮小、切換不到該年度。
- **refresh/切換 race**：60s 自動 refresh 與使用者切換年度可能交錯；`loadYear` 以 fetchToken 遞增 + stale-drop（`token !== fetchToken` 即丟棄）防護，只讓最新一次請求 render。
- **全部年度失敗**：CLI 零寫入（前一輪 `data/` 原封不動）且 **exit 1** → workflow 的「Commit data if changed」步驟直接失敗、不 commit 不 deploy，舊站繼續服務舊資料。若要補救需手動重跑 `workflow_dispatch`。
- **copy-data 語意**：只複製 `^\d{4}\.json$`、清掉舊年度檔；**meta.json 故意不複製**（client 不消費它）。

## 驗證標準（改版後必跑）

```bash
bun test                    # 目前 22 pass（scraper 單元測試，含 scrape-cli 的 collectYears/buildMeta；fixture-based 不打網）
bunx tsc --noEmit           # 全專案型別乾淨
cd web && bun run build     # Astro build 成功，dist/ 產出
```

改版後手動驗證（headless browser 實測過）：載入 126+ 卡片、group filter 篩對、三種排序 reorder、60s refresh 事件更新 updatedAt、無 console error、無 XSS（client DOM 一律 `textContent`，禁 `innerHTML` 放使用者資料）。

## 部署操作速查

```bash
# 手動觸發更新
gh workflow run scheduled-update --repo kehao-chen/ithome-ironman-observer-next
gh run watch <run-id> --repo kehao-chen/ithome-ironman-observer-next

# Worker 手動觸發（等於 cron 做的事）
curl -X POST https://ironman-observer-trigger.happyhacking.workers.dev/dispatch
curl https://ironman-observer-trigger.happyhacking.workers.dev/   # 健康檢查

# Worker secrets（已設，勿刪）
cd worker && npx wrangler secret list
# → GITHUB_TOKEN（fine-grained PAT，Actions: Read and write）、GITHUB_REPO

# secrets（已設，勿刪）
gh secret list --repo kehao-chen/ithome-ironman-observer-next
# → CLOUDFLARE_API_TOKEN（Pages Edit）、CLOUDFLARE_ACCOUNT_ID

# 自有網域在 Cloudflare dashboard 設（wrangler.toml 的 routes 對 Pages 無效，已移除）
```

## 排程與成本決策紀錄（2026-08-05 更新）

### cron 演進（踩過的坑）

- 原本：每小時全時 `0 * * * *`（720 runs/mo）。
- 13:43 `2a1c0e5`：改成 `0 23-23,0-17 * * *`，意圖是「臺北 07:00–01:00 每小時」。
- **坑**：該寫法等效 `0 23,0-17 * * *`，語意正確，但 GH Actions 排程器對變更後的 cron 幾乎沒重新觸發——從 13:43 到當天 20:48 只自動跑了 1 次（16:28，還遲到 28 分鐘），其餘全靠手動 `workflow_dispatch` 撐。
- 修正 `6b699e6`：改寫成 `0 0-17,23 * * *`（等效、更明確），推送後下一個整點（20:48 臺北）排程恢復自動觸發。
- **教訓**：`schedule` 觸發由 GitHub 排程器負責，**與 runner 無關**；低頻 repo 可能被排程服務節流、整點高峰可能延遲甚至跳過。改 cron 後若沒觸發，先在 Actions 看 run 是否存在，再考慮外部觸發保險。

### 決策：改用 Cloudflare Worker cron 觸發（2026-08-06）

- **原因**：更新頻率提升到每 10 分鐘後，GH `schedule` 的整點高峰延遲/漏觸發問題（官方文件確認 high-load 時可能 delay/drop）不可接受。
- **方案**：`worker/` 新增 `ironman-observer-trigger`（Cloudflare Workers free tier，cron `*/10 * * * *`，10ms CPU 只做 HTTP dispatch，遠低於免費額度）。`scheduled()` 打 GitHub `workflow_dispatch` API 觸發 `scheduled-update` workflow。依 `run_number` 去重：同一個 run 最多 dispatch 一次，避免 cron 重疊造成並行抓取。
- **改動**：`.github/workflows/update.yml` → `scheduled-update.yml`，移除 `schedule` 只留 `workflow_dispatch`（避免雙重觸發）。
- **成本**：144 次/天 × ~2.5 min ≈ **6 小時/天** runner 時間，public repo 免費；Worker 請求 ~144/天遠低於 100k/day 免費額度。對 ithelp 請求量 ~250 req × 144 ≈ **3.6 萬次/天**（原 18 次/天時為 4,500 次/天）。
- **self-hosted runner 明確排除**：public repo 用 self-hosted 是 GitHub 官方安全警告（任何人開 PR 可在你的機器跑任意程式碼）；且排程觸發在 GitHub 端，換 runner 無法改善排程可靠性。
