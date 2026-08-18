# 鐵人觀察家 Next — 部署與交接紀錄

> 狀態：**已上線**。本文是 2026-08-05 實作 session 的交接文件，供後續 session（尤其 UI/UX 改版）快速接續。設計與實作細節見 spec 與 plan。

> **2026-08-07 更新（後續 session 以本段為準）**
> - 測試：`bun test` 由 41 pass 增至 **185 pass**（新增 view-model / 結構契約測試 29 個：`card.ts` 18 + `card-dom.ts` 11）。
> - 資料：2026 系列數 127 → **147**（報名期間持續增加）。
> - 已知問題 #1（全 inline style / dark-only / 無設計系統）、#2（DAY badge 不一致）、#4（placeholder filter style）**已修復**；#3（未開賽卡片空洞）已改善：顯示「報名於 YYYY/MM/DD」，已刪文系列顯示「文章已全數刪除」。
> - 卡片顯示邏輯已收斂到 `web/src/lib/card.ts`：SSR `SeriesCard.astro` 與 client `renderCard`/`renderRow` 共用同一 view-model（`cardViewModel`），降低 drift 風險。
> - `web/public/lighthouse-report.html` 已移至 `docs/`（不再部署）。

> **2026-08-18 更新（本段為最新，優先於上段）**
> - 測試：`bun test` 現為 **250 pass**（18 files，0 fail；root 已補 `happy-dom` devDep，DOM 契約測試可直接跑）。
> - 資料：2026 系列數 **241** / 17 組別（報名期間持續增加中）；有文章 177 支、未開賽 64 支（2026-08-18 快照）。
> - **設計系統已落地**（原已知問題 #1 確認修復，文件過時已更新）：`web/src/styles/design-system.css`（1313 行）三頁面統一 inline 引入，token 由 `.impeccable/design.json` 定義；Dashboard/SeriesCard/Teams 無殘留硬編碼 inline style（僅剩 `var(--space-4)` 等 token 用法）；card/teams 結構契約測試鎖 DOM 骨架。
> - **DAY 資料正確性修復**（scraper）：
>   - `parse-series.ts`：day 優先序改為標題 `Day N` 前綴 → DAY 徽章（iThome 分頁第 2 頁起徽章凍結在當下參賽天數：帶刺哥 30 篇全標 DAY 12、shaoyukao 第 17/18 篇標 DAY 16、fishbob 1,1,2,3,4,5,6）；徽章無數字不產生 NaN；同頁徽章重複且無標題前綴時續接（+1）。救回 10 支系列。
>   - `scrape.ts`：`dayCount` 語意改為「標頭 vs 實際去重 DAY 數取較大」（常態 = 上游「參賽天數」；標頭凍結/矛盾時以 `min(去重 day 數, 文章數)` 覆蓋；已刪文系列維持標頭值）。alanliang/jackietung/c8763yee 標題無 Day 前綴 + 上游徽章壞（無法用 parser 救）的系列，dayCount 現在反映實際文章數。
> - 時間顯示格式已統一（原已知問題 #5 修復）：`web/src/lib/format.ts` 提供 `tzTime`/`isoInitial`，SSR（SeriesCard.astro / Dashboard.astro frontmatter）與 client（Dashboard humanizeAll / card-dom）共用；絕對時間固定 `Asia/Taipei`（不再依賴瀏覽器時區），相對時間維持「剛剛/N 分鐘前/N 小時前/昨天」。
> - Roadmap 全數完成（含 badge enhancements / real-time 近即時已定案為架構終點）；PRODUCT.md 已同步。

## 現況速覽

| 項目 | 值 |
|---|---|
| 線上站 | https://ithome-ironman-observer.happyhacking.ninja/ |
| 後備網址 | https://ironman-observer-next.pages.dev/ |
| GitHub | https://github.com/kehao-chen/ithome-ironman-observer-next |
| 資料 | 241 支系列 / 17 組別（2026-08-18，報名持續增加中） |
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
- **每 10 分鐘全量抓取** ~340 requests（170 系列 × 2 + 分頁），約 2.5 min/run。

## 關鍵檔案地圖

| 路徑 | 內容 |
|---|---|
| `scripts/scrape.ts` | orchestrator：讀 `config/series-manifest.json` 陣列，**逐年度**跑 `runScrape`（per-year try/catch；series 為 0 或 throw = 該年度失敗，console.error 後繼續）。**至少一年成功** → 寫出每個成功年度 `data/{year}.json` + `data/meta.json`，exit 0；**全部失敗** → 零寫入（保留舊資料）、exit 1（workflow 因步驟失敗而不 commit，舊站繼續服務舊資料）。`taipeiTimestamp()` 輸出正確臺北時間（曾修過 toISOString 誤標 bug）；`collectYears`/`buildMeta` 為純函式（有測試） |
| `scripts/parse-signup.ts` | signup 列表 HTML → SignupCard（含 `decodeHtmlEntities`，資料必須存純文字） |
| `scripts/parse-rss.ts` | RSS → RssChannel；`parseRfc822` 保留來源 offset 牆鐘（曾修過 UTC 誤標 bug） |
| `scripts/parse-series.ts` | series 頁 → SeriesStats（瀏覽/Like/留言/訂閱） |
| `scripts/html-entities.ts` | 共享 entity 解碼（&amp; 等）：**必須在 parse 時解，否則 Astro/client 雙重跳脫顯示 &amp;amp;** |
| `scripts/types.ts` | 全專案共享型別（scraper + Astro 共用） |
| `web/scripts/copy-data.mjs` | build 前置：清空 `web/public/data/` 所有 `^\d{4}\.json$` → 複製全部 `data/^\d{4}\.json$`；**meta.json 不複製**（client 不需要） |
| `web/src/pages/index.astro` | 頁面：glob `data/*.json`（4 碼年份 key）+ dynamic import meta；`years = meta.years ∩ 實際存在檔案`；`<title>` 隨年度動態 |
| `web/src/components/Dashboard.astro` | **UI/UX 主戰場**：header、**年度切換器**（`#year-select`，以 meta `years` 為權威）、**60s client refresh**（`loadYear` + fetchToken 防 stale race）、group filter（container delegation、僅年度變更時重建 chips）、sort、scrapeLog notice（`<details id="scrape-log">`，空時 hidden）、renderCard（大量 inline style） |
| `web/src/components/SeriesCard.astro` | 靜態卡片（SSG 版）；與 client renderCard 需保持欄位一致 |
| `config/series-manifest.json` | **年度清單（單一來源；陣列）**：`[{ year, signupListUrl }]`，多年度架構從這裡擴 |
| `.github/workflows/scheduled-update.yml` | workflow（僅 `workflow_dispatch`；原 `schedule` 已移除，由 Worker 觸發）；secrets: `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |
| `worker/` | Cloudflare Worker `ironman-observer-trigger`（cron `*/10 * * * *`）：`scheduled()` 打 `workflow_dispatch`，依 `run_number` 去重避免重疊；`GET /` 健康檢查、`POST /dispatch` 手動觸發；secrets: `GITHUB_TOKEN`（Actions:write PAT）、`GITHUB_REPO` |

## 已知問題 / 改版候選（2026-08-18 更新）

> 原 8 項已全數解決或收斂：設計系統落地（#1）、DAY badge 統一（#2）、未開賽卡片改善（#3）、filter placeholder（#4）、時間格式統一（#5）、排序語意維持（#6，見下）、ChatGPT & Codex entity（#7）、零文章系列沉底（#8，見下）。

1. **排序語意**（原 #6，維持現行定義）：「最新發布」= `articles` 最後一筆的 `publishedAt`（= 最新 Day）；「最多觀看」= 該系列全部文章 views 總和。若想改定義（如當日新增文章數）可再討論，非 bug。
2. **零文章系列沉底**（原 #8）：`articleCount === 0`（尚未開賽）篩選/排序時混在最後，有意為之。
3. **上游 day 資料無法完全修復**：alanliang（26 篇標頭 16）、jackietung（11 篇標頭 10）、c8763yee（11 篇標頭 10）標題無 `Day N` 前綴且 iThome 徽章本身壞 → parser 無法還原每篇的 day；`dayCount` 已改為反映實際文章數（min(去重 day, 文章數)），但單篇 day 欄位仍與真實第幾篇有偏差。
4. **已刪文系列 3 支**（dayCount>0 且 0 篇）：芥龍（day 13）、stca（day 8）、因田木（day 4）——卡片顯示「文章已全數刪除」，維持判別式 `dayCount > 0 && articleCount === 0`。

### 多年度（2026-08-06 新增，Task 1–6 實作）

- **meta 語意**：`data/meta.json` = `{ latestYear, years（desc）, updatedAt, seriesCount }`；`years` 是 UI 年度選項的**唯一權威**（index.astro 再與實際存在的 `data/{year}.json` 取交集做防禦）。`seriesCount`/`updatedAt` 屬 latestYear。
- **空資料年度**：某年度抓取失敗但舊檔仍在 → 保留舊 `{year}.json`，但該年度**不寫入 `meta.years`**（buildMeta 只收成功年度）→ UI 選項縮小、切換不到該年度。
- **refresh/切換 race**：60s 自動 refresh 與使用者切換年度可能交錯；`loadYear` 以 fetchToken 遞增 + stale-drop（`token !== fetchToken` 即丟棄）防護，只讓最新一次請求 render。
- **全部年度失敗**：CLI 零寫入（前一輪 `data/` 原封不動）且 **exit 1** → workflow 的「Commit data if changed」步驟直接失敗、不 commit 不 deploy，舊站繼續服務舊資料。若要補救需手動重跑 `workflow_dispatch`。
- **寫入流程（可回復 commit protocol）**：全年度抓取結果先留 memory → 全部寫 `.tmp` 暫存（同目錄、meta 最後）→ 成功才依序 rename 覆蓋（POSIX 單檔 rename atomic）→ **中途失敗會從 `.bak` 還原已覆蓋檔案並清理暫存**。保證：staging 失敗 → 零 rename、舊資料完整；commit 中途失敗 → rollback 還原，不會留下跨年度混合狀態（best-effort per-file rollback，原錯誤仍 rethrow、CLI exit 1）→ workflow 不 commit。
- **copy-data 語意**：只複製 `^\d{4}\.json$`、清掉舊年度檔；**meta.json 故意不複製**（client 不消費它）。

## 驗證標準（改版後必跑）

```bash
bun test                    # 目前 250 pass：scraper 單元測試 + web lib/components 測試（含 format/daily-status/filter/search/favorites/insights/card/card-dom/teams）
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
- **成本**：144 次/天 × ~2.5 min ≈ **6 小時/天** runner 時間，public repo 免費；Worker 請求 ~144/天遠低於 100k/day 免費額度。對 ithelp 請求量 ~340 req × 144 ≈ **4.9 萬次/天**（原 18 次/天時為 4,500 次/天）。
- **self-hosted runner 明確排除**：public repo 用 self-hosted 是 GitHub 官方安全警告（任何人開 PR 可在你的機器跑任意程式碼）；且排程觸發在 GitHub 端，換 runner 無法改善排程可靠性。
