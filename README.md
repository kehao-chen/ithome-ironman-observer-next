# 鐵人觀察家 Next

2026 iThome 鐵人賽的每日觀察儀表板。靜態站 + GitHub Actions 定時自動更新 + Cloudflare Pages 免費託管。

🔗 線上站：https://ithome-ironman-observer.happyhacking.ninja/

## 專案起源

本專案源自 [qrtt1/ithome-ironman](https://github.com/qrtt1/ithome-ironman) 的 ITHome 鐵人觀察家（觀戰區），
因原專案已停止維護，故另開新專案接手這個概念，以現代工具鏈（Bun + Astro + GH Actions + Cloudflare Pages）重寫。

## 這個專案的挑戰

這是一個實驗：以 **Command Code 的 $1/月 訂閱**，搭配 **DeepSeek v4 Flash**，
能否真的做出一個有趣、可用的東西？

整個專案（scraper、儀表板、CI/CD、部署、測試）皆由這個組合完成。

### 費用紀錄

第一個核心功能版本的費用：

| 項目 | 數值 |
|---|---|
| Total Tokens | 57.5M |
| 費用 | **$0.42** |
| Runs | 839 |

![Command Code usage](docs/command-code-usage.png)

## 架構

ithelp 鐵人賽 → Cloudflare Worker cron（每 10 分鐘）→ workflow_dispatch → GH Actions → data/2026.json commit → Astro build → Cloudflare Pages

- **Scraper**（`scripts/`，Bun + TypeScript）：抓 signup 列表全部分頁 → 每系列 RSS + series 頁 → 合併為 `data/2026.json`（瀏覽/Like/留言/訂閱數、`lastUpdated`、文章清單）。容錯：單系列失敗不中斷、指數退避重試、空結果保留舊資料。
- **儀表板**（`web/`，Astro）：SSG 預渲染 + client 端 60 秒刷新，組別篩選 + 進度/最多觀看/最新發布排序。
- **排程**（`worker/` + `.github/workflows/scheduled-update.yml`）：Cloudflare Worker `ironman-observer-trigger` 每 10 分鐘打 `workflow_dispatch` 觸發更新（GitHub 原生 `schedule` 在整點高峰會延遲/漏觸發，故改用 CF 網路排程）；資料有變才 commit + deploy（無變更跳過）。

## 本地開發

```bash
bun install
bun run scripts/scrape.ts     # 抓取最新資料到 data/2026.json
cd web && bun install && bun run dev
```

## 測試

```bash
bun test
```

## 部署（已上線，僅供參考）

1. Cloudflare Pages 專案 `ironman-observer-next`（workflow 會自動建立）
2. GitHub repo secrets：`CLOUDFLARE_API_TOKEN`（Pages Edit 權限）、`CLOUDFLARE_ACCOUNT_ID`
3. 自有網域在 Cloudflare dashboard → Pages 專案 → Custom domains 設定
4. Cloudflare Worker `ironman-observer-trigger`（cron `*/10 * * * *`，secrets: `GITHUB_TOKEN`、`GITHUB_REPO`）定時觸發 workflow；也可 `gh workflow run scheduled-update` 手動觸發
