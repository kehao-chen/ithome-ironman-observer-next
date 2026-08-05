# 鐵人觀察家 Next — 設計文件

日期：2026-08-05
狀態：Approved（2026-08-05，經 brainstorming 流程）

## 目標

復刻 qrtt1 的「ITHome 鐵人觀察家」（原站 2024 停更、未開源）之核心體驗：一個儀表板，讓使用者快速掌握 2026 iThome 鐵人賽每天的文章動態，並依主題（組別）瀏覽、排序。以「近乎免費」為硬性約束。

**非目標**（第一版不做，但架構保留空間）：
- 多年度資料（2024/2025 回溯）
- 搜尋功能
- 完賽/進行中狀態徽章
- 使用者登入、收藏、追蹤
- 即時更新（首版只做週期性批次更新）

## 資料源（已實測驗證，2026-08-05）

| 來源 | URL | 取得內容 | 需登入 |
|---|---|---|---|
| 選手列表 | `https://ithelp.ithome.com.tw/2026ironman/signup/list?page=N` | 系列 ID、組別、作者、報名日期、系列標題/描述、所屬團隊、DAY 進度 | 否 |
| 系列 RSS | `https://ithelp.ithome.com.tw/rss/series/{seriesId}` | 每篇：Day 標題、文章連結、發佈時間（pubDate） | 否（需瀏覽器 UA） |
| 系列頁 | `https://ithelp.ithome.com.tw/users/{uid}/ironman/{seriesId}` | 每篇：瀏覽數、Like、留言；系列：參賽天數、文章數、訂閱數 | 否 |

實測數據點：
- 2026 報名數 125，series ID 9028–9153，分頁 13 頁（每頁 ~10）
- RSS 文章數與 series 頁完全一致（進行中系列 9066：5 篇；完賽系列 8503：30 篇）
- RSS 需瀏覽器 User-Agent，否則 403（Cloudflare challenge）
- 每系列完整資料 = RSS(1 request) + series 頁(1 request) = 2 request；全量 ≈ 250 request/輪詢

## 架構

```
ithelp 鐵人賽
   │ (HTTP, 2 requests/series)
   ▼
GH Actions cron (scraper + builder)
   │ 寫出 data/2026.json + 靜態站
   ▼
git repo（data commit）
   │
   ▼
wrangler pages deploy
   ▼
Cloudflare Pages（自有網域，全球 CDN 免費方案）
```

- **無後端伺服器**：全部靜態。資料以 JSON 形式存在 repo，Astro build 時預渲染，client 端 fetch 更新。
- **無需資料庫**：JSON 檔案即資料庫。
- **免費額度驗證**：GH Actions 免費 2000 min/月（cron 每小時一次 build 約 1-2 min → 遠低於上限）；Cloudflare Pages 免費方案無限流量。總成本 $0。

## 組件

### 1. Scraper（`scripts/scraper/`）
- 輸入：`config/series-manifest.json`（年度清單）
- 流程：
  1. 拉 `signup/list` 全部分頁 → 系列基本資料
  2. 對每個系列：拉 RSS → 文章清單；拉 series 頁 → 瀏覽數/Like/留言/訂閱數
  3. 合併為 `data/{year}.json` + 更新 `data/meta.json`（`updatedAt`＝本次抓取時間、`seriesCount`）
- 「更新時間」卡片欄位＝series 最後更新（RSS `lastBuildDate`）
- 輸出格式（與舊觀察家 ui-data.json 相容的演進）：
```json
{
  "year": 2026,
  "updatedAt": "2026-08-05T09:00:00+08:00",
  "groups": ["AI Engineering", "DevOps", ...],
  "series": [
    {
      "id": 9066,
      "user": {"id": 20168288, "name": "Kehao", "profileUrl": "..."},
      "group": "AI Engineering",
      "title": "Backend 工程師的 Azure GenAI 實戰",
      "description": "...",
      "team": null,
      "signupDate": "2026-08-01T12:00:31+08:00",
      "dayCount": 5,
      "articleCount": 5,
      "subscriptions": 6,
      "articles": [
        {
          "id": 10401594,
          "day": 5,
          "title": "Day 5：第一個 Chat API……",
          "url": "https://ithelp.ithome.com.tw/articles/10401594",
          "publishedAt": "2026-08-05T08:57:56+08:00",
          "views": 21,
          "likes": 0,
          "comments": 0
        }
      ]
    }
  ]
}
```
- 錯誤處理：單一系列失敗不中斷全量；重試（指數退避）；UA header 必帶。

### 2. Astro 靜態站（`web/`）
- 單頁儀表板：
  - 組別篩選（tag 列）
  - 排序：最新發布 / 最多觀看
  - 系列卡片：標題、作者、組別、最新 Day、觀看數、發佈時間、更新時間
- 資料載入：SSG 預渲染 + client 端 `fetch('/data/2026.json')`
- 響應式（手機可用）

### 3. GH Actions（`.github/workflows/update.yml`）
- `schedule: cron('0 * * * *')`（每小時）
- Steps: checkout → setup bun → `bun run scrape` → 若有資料變更則 commit → `bun run build` → `wrangler pages deploy`
- 資料無變更時跳過部署（避免無意義 commit）

### 4. 部署設定
- `wrangler.toml`：Cloudflare Pages 專案、自有網域、`_headers`/`_redirects`（快取策略：JSON 短 TTL，HTML 長 TTL）

## 資料流

1. cron 觸發 → scraper 拉取 → 寫 `data/2026.json` + 更新 `data/meta.json`（updatedAt）
2. 有變更 → commit → Astro build → deploy
3. 使用者瀏覽 → CDN 快取 HTML/JSON

## 錯誤處理

- ithelp 回 403（Cloudflare challenge）：帶完整瀏覽器 UA + Accept headers；重試 3 次指數退避
- 單系列失敗：記入 `scrape-log` 欄位，不 abort
- 空資料防護：若 scraped 結果為空（如賽事尚未開始），保留上次資料不覆寫

## 測試

- scraper 單元測試：HTML/XML parser（fixture 檔）→ 正確解析系列欄位
- RSS parser 測試：pubDate 解析、Day 擷取
- 整合測試（可選，不打網）：用 fixture 檔跑全流程

## 里程碑

1. M1：scraper 跑通，產出 `data/2026.json`（125 系列全量抓取成功）
2. M2：Astro 站顯示資料、篩選/排序可用
3. M3：GH Actions cron + Cloudflare Pages 部署上線
4. M4：驗證週期更新（隔小時資料有變 → 新 commit → 新部署）
