# 鐵人觀察家 Next

2026 iThome 鐵人賽的每日觀察儀表板。靜態站 + GitHub Actions 每小時自動更新 + Cloudflare Pages 免費託管。

## 架構

ithelp 鐵人賽 → GH Actions (cron) → data/2026.json commit → Astro build → Cloudflare Pages

## 本地開發

```bash
bun install
bun run scripts/scrape.ts     # 抓取最新資料到 data/2026.json
cd web && bun install && bun run dev
```

## 部署

1. 建 Cloudflare Pages 專案（名稱 `ironman-observer-next`）
2. 加 domain 到 `wrangler.toml` 的 routes
3. 設 `CLOUDFLARE_API_TOKEN` secret（Pages Edit 權限）
4. 推上 GitHub，workflow 每小時自動跑

## 測試

```bash
bun test
```
