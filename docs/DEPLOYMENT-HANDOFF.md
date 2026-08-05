# 鐵人觀察家 Next — 部署與交接紀錄

> 狀態：**已上線**。本文是 2026-08-05 實作 session 的交接文件，供後續 session（尤其 UI/UX 改版）快速接續。設計與實作細節見 spec 與 plan。

## 現況速覽

| 項目 | 值 |
|---|---|
| 線上站 | https://ithome-ironman-observer.happyhacking.ninja/ |
| 後備網址 | https://ironman-observer-next.pages.dev/ |
| GitHub | https://github.com/kehao-chen/ithome-ironman-observer-next |
| 資料 | 127 支系列 / 17 組別（2026-08-05，報名持續增加中） |
| 排程 | 臺北時間 07:00–01:00 每小時（18 次/天 ≈ 547 runs/月；public repo 的 GitHub-hosted runner 免費且不計分鐘） |
| 部署鏈 | 全自動，最後一次手動驗證 run 30978443677 全綠 |

## 架構（已上線，勿破壞契約）

```
ithelp 鐵人賽 (signup 列表 + RSS + series 頁)
   │  browser UA 必帶 (403 否則)
   ▼
GH Actions cron (.github/workflows/update.yml)
   ├─ bun run scripts/scrape.ts      → data/2026.json + data/meta.json
   ├─ 資料有變才 commit + push       → 無變更 exit 0 跳過
   ├─ cd web && bun install && build → dist/
   └─ npx wrangler pages deploy      → Cloudflare Pages
```

- **零成本**：GH Actions free tier + Cloudflare Pages free tier + 自有網域。無後端、無 DB（JSON 即 DB）。
- **每小時全量抓取** ~250 requests（127 系列 × 2 + 分頁），約 2.5 min/run。

## 關鍵檔案地圖

| 路徑 | 內容 |
|---|---|
| `scripts/scrape.ts` | orchestrator：分頁抓 signup → 每系列 RSS+series 頁 → merge → 寫 JSON。`taipeiTimestamp()` 輸出正確臺北時間（曾修過 toISOString 誤標 bug） |
| `scripts/parse-signup.ts` | signup 列表 HTML → SignupCard（含 `decodeHtmlEntities`，資料必須存純文字） |
| `scripts/parse-rss.ts` | RSS → RssChannel；`parseRfc822` 保留來源 offset 牆鐘（曾修過 UTC 誤標 bug） |
| `scripts/parse-series.ts` | series 頁 → SeriesStats（瀏覽/Like/留言/訂閱） |
| `scripts/html-entities.ts` | 共享 entity 解碼（&amp; 等）——**必須在 parse 時解，否則 Astro/client 雙重跳脫顯示 &amp;amp;** |
| `scripts/types.ts` | 全專案共享型別（scraper + Astro 共用） |
| `web/src/pages/index.astro` | 頁面 + 60s client refresh（fetch /data/2026.json?t=） |
| `web/src/components/Dashboard.astro` | **UI/UX 主戰場**：header、group filter、sort、renderCard（大量 inline style） |
| `web/src/components/SeriesCard.astro` | 靜態卡片（SSG 版）；與 client renderCard 需保持欄位一致 |
| `config/series-manifest.json` | 年度清單（單一來源；多年度架構從這裡擴） |
| `.github/workflows/update.yml` | cron + 部署鏈；secrets: `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |

## 已知問題 / UI/UX 改版候選（新 session 討論起點）

1. **整體視覺**：全 inline style、暗色主題、無設計系統。使用者已表達「UI/UX 整體蠻糟」。
2. **DAY badge 不一致**：static `SeriesCard.astro` 對 `尚未開賽`（dayCount 0）顯示 `DAY ?`，client `renderCard` 顯示 `尚未開賽`。改版時統一（client 渲染會蓋過 static，所以實際使用者看到的是 client 版）。
3. **`尚未開賽` 30 系列**：顯示上只有 badge 差異，卡片其餘欄位（無文章）較空。
4. **filter 按鈕的 placeholder style**：Task 7 遺留 `style="..."`（字面值），一直沒補。改版時自然處理。
5. **更新時間格式**：`updatedAt` 是 `"YYYY-MM-DD HH:mm:ss+08:00"`（空格分隔、無毫秒），`lastUpdated`/`publishedAt` 是 `T` 分隔 ISO。兩者格式不統一（display-only，`<time datetime>` 兩種都吃）。
6. **排序語意**：「最新發布」目前是 `articles` 最後一筆的 `publishedAt`（= 最新 Day）；「最多觀看」是該系列全部文章 views 總和。若有更好的定義（如當日新增文章數）可在改版討論。
7. **群組「ChatGPT & Codex」**：entity 已解碼為正確 `&`，確認 UI 顯示正常即可。
8. **零文章系列 30 支**：`articleCount === 0`（尚未開賽），篩選/排序時會混在最後。

## 驗證標準（改版後必跑）

```bash
bun test                    # 目前 18 pass（scraper 單元測試，fixture-based 不打網）
bunx tsc --noEmit           # 全專案型別乾淨
cd web && bun run build     # Astro build 成功，dist/ 產出
```

改版後手動驗證（headless browser 實測過）：載入 126+ 卡片、group filter 篩對、三種排序 reorder、60s refresh 事件更新 updatedAt、無 console error、無 XSS（client DOM 一律 `textContent`，禁 `innerHTML` 放使用者資料）。

## 部署操作速查

```bash
# 手動觸發更新
gh workflow run hourly-update --repo kehao-chen/ithome-ironman-observer-next
gh run watch <run-id> --repo kehao-chen/ithome-ironman-observer-next

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

### 決策：維持 GitHub 免費資源，暫不引進 self-hosted runner / Cloudflare Worker

- **現在**：public repo 的 GitHub-hosted runner **免費且不計分鐘**。目前用量 ≈ 547 runs/月 × 2.5 min ≈ **22 小時/月**，遠低於任何額度上限。**$0 成本，無需任何變動。**
- **不要**為了解決排程漏觸發去裝 VPS self-hosted runner——排程在 GitHub 端，runner 換到哪都一樣；且 public repo 用 self-hosted runner 有 GitHub 官方安全警告（任何人開 PR 即可在 VPS 執行任意程式碼）。
- **觸發條件（使用者明確認可）**：
  1. GitHub-hosted 免費額度開始不夠用（public repo 幾乎不可能）→ 上 self-hosted runner，且只讓 `schedule`/`workflow_dispatch` 用它，PR 相關 job 一律 GitHub-hosted。
  2. 若排程又開始漏觸發（「每小時」是硬需求時）→ 兩個免費保險擇一：VPS cron 每小時打 `workflow_dispatch` API，或 Cloudflare Free Worker Cron Trigger（$0，CPU <10ms 只做 dispatch 觸發）。
