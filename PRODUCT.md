# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro 5 static site (`web/`), TypeScript shared with scraper (`scripts/types.ts`), native CSS with custom properties, no framework. Data pipeline: GH Actions cron → `bun run scripts/scrape.ts` → per-year `data/{year}.json` + `data/meta.json` (`years` = year-switcher authority) → Astro build → Cloudflare Pages. Zero-cost constraint (no paid backend/db; JSON is the DB).

## Users

People following the 2026 iThome Ironman competition (Taiwan tech blogging event). The user watches ~127 participating series across 17 categories and wants to quickly see daily article progress and popularity. Likely readers/authors, revisiting the site repeatedly to track the series they care about.

## Product Purpose

A dashboard that lets the user grasp the daily article dynamics of the 2026 iThome Ironman and browse/sort series by category. Success = the user can quickly answer "which series are active, which are popular, what's the latest article" without manual effort.

## Positioning

Recreation of qrtt1's original "ITHome 鐵人觀察家" (original went silent in 2024, not open-sourced) with the same core experience: an at-a-glance dashboard of daily article activity, browsable and sortable by group. Modernized, self-hosted, near-zero cost.

## Operating Context

- Scraper hits ithelp.ithome.com.tw (signup list + RSS + series pages), ~2 requests/series, ~340 requests/full sweep; **browser UA required** (403 otherwise).
- Cron: Cloudflare Worker `ironman-observer-trigger` fires `workflow_dispatch` every 10 min (144 runs/day; public-repo GitHub-hosted runner stays free). GitHub's native `schedule` trigger was dropped (delayed/dropped at the top of every hour).
- Data changes commit + deploy automatically; site refreshes client-side every 60s.
- UI is a single-page dashboard: year switcher (header select) + category filter (tag row) + sort (progress / most views / today's posts) + series cards. Cards show: title, author, group, latest day, views, publish time, update time.
- Per-year `data/{year}.json` is the DB (2026 data currently); `data/meta.json`'s `years` is the sole authority for the year switcher options; entity-decoding must happen at parse time (`html-entities.ts`), never client-side (double-escaping). Client DOM uses `textContent` only — `innerHTML` with user data is forbidden (XSS).

## Capabilities and Constraints

ithelp 鐵人賽 → Cloudflare Worker cron（每 10 分鐘）→ workflow_dispatch → GH Actions → data/{year}.json + data/meta.json commit → Astro build → Cloudflare Pages

- **Scraper**（`scripts/`，Bun + TypeScript）：依 `config/series-manifest.json` 陣列**逐年度**抓取（signup 列表全部分頁 → 每系列 RSS + series 頁），成功年度各寫一支 `data/{year}.json`（瀏覽/Like/留言/訂閱數、`lastUpdated`、文章清單），並寫出 `data/meta.json`（`latestYear` / `years` / `updatedAt` / `seriesCount`）。容錯：單系列失敗不中斷、指數退避重試；年度層級 per-year try/catch——**全部年度失敗時零寫入（保留舊資料）且 exit 1，至少一年成功則寫出成功年度並 exit 0**。
- **儀表板**（`web/`，Astro）：SSG 預渲染 + client 端 60 秒刷新（於 Dashboard 元件），header 年度切換器、組別篩選 + 進度/最多觀看/最新發文/當篇觀看（今日）排序、**「我的收藏」分頁（localStorage 書籤，系列 ID 跨年度共用）**，抓取失敗系列數以 scrapeLog notice 顯示。年度切換器（header select）以 `data/meta.json` 的 `years` 為唯一權威；空資料年度保留舊檔、但選項縮小。
- **排程**（`worker/` + `.github/workflows/scheduled-update.yml`）：Cloudflare Worker `ironman-observer-trigger` 每 10 分鐘打 `workflow_dispatch` 觸發更新（GitHub 原生 `schedule` 在整點高峰會延遲/漏觸發，故改用 CF 網路排程）；資料有變才 commit + deploy（無變更跳過）。
- Browser UA mandatory for scraping; RSS/series page consistency verified.
- Known current UI issues (as of 2026-08-07, updated 2026-08-11): fixed since the 08-05 handoff — design system (`DESIGN.md` + `web/src/styles/design-system.css`), light/dark/auto theme, unified DAY badge, card view-model + DOM builders shared between SSR/client (`web/src/lib/card.ts` + `card-dom.ts`, structural contract tests), `updatedAt` 顯示格式統一（`web/src/lib/format.ts`，SSR/client 共用；絕對時間固定 Asia/Taipei），未開賽系列顯示「尚未開賽（已報名 N 天）」（報名日→臺北曆日差）。Remaining nits: the site polls ithelp every 10 min (~36k req/day).

## Brand Commitments

- Name: 鐵人觀察家 (Ironman Observer), year 2026.
- Language: Traditional Chinese only (user-confirmed).
- Minimal wordmark identity: a simple text wordmark, overall tool-first aesthetic (user-confirmed).
- Original qrtt1 observer is the reference for the core experience (not visual identity).

## Evidence on Hand

- `data/2026.json` (current year) + `data/meta.json` (`latestYear` / `years` / `updatedAt` / `seriesCount`): live scraped data — 2026: 170 series / 17 groups (2026-08-11).
- `docs/DEPLOYMENT-HANDOFF.md`: deployment + handoff record, known-issues list.
- `docs/superpowers/specs/2026-08-05-ironman-observer-next-design.md`: original design spec (approved).
- No logos/assets provided; no testimonials, benchmarks, or pricing claims exist and must not be fabricated.

## Product Principles

1. Data-first: the dashboard's job is scanability and comprehension; visual identity serves precision, not expression.
2. Near-zero cost is a hard constraint — no paid services, no backend, no DB.
3. Automation over manual ops: data changes commit and deploy themselves.
4. Preserve the core observer experience (grasp daily activity, browse by group) while modernizing the surface.
5. Non-goals stay out of v1: no accounts.

## Roadmap

Feature ideas carried over from the removed `docs/PROJECT-INTRODUCTION.md`, plus v1 non-goals. Not scheduled; prioritize by value/cost before building.

### Near-term (low cost, fits current architecture)

近程三項已全數完成（2026-08-05/06）；以下保留紀錄。

1. [x] **Multi-year support**（完成 2026-08-06）：`config/series-manifest.json` 是年度單一來源；scraper 逐年度寫出 `data/{year}.json` + `data/meta.json`（`years` = 年度切換器唯一權威，`latestYear`/`updatedAt`/`seriesCount`）。**Meta 語意**：空資料年度（抓取失敗但舊檔仍在）保留舊 `{year}.json`、但從 `meta.years` 排除——UI 選項縮小。
2. [x] **Sort refinement**（完成 2026-08-05，daily-status 功能）：`latest` 排序重定義為「今日發文」（依臺北日 desc，同日內按發文秒 desc；無文章系列沉底）。
3. [x] **Surface scrapeLog errors**（完成 2026-08-06）：固定 scrapeLog notice（`<details id="scrape-log">`）顯示「N 支系列本次抓取失敗」+ 錯誤清單，空時隱藏（`hidden`）。

### Mid-term candidates (from v1 non-goals; re-evaluate value before building)

- [x] **Search**（完成 2026-08-06）：`web/src/lib/search.ts` 純函數（`normalize` + token AND）＋toolbar `#search` input 即時過濾；命中標題/作者/組別/團隊；與組別分頁（含收藏分頁）、排序器自由組合；搜尋空狀態 `role="status"`；Escape 清空（RSS modal 優先）；跨年度 query 保留。
- [x] **Completion / activity badge enhancements**（完成 2026-08-05，daily-status 功能）：`web/src/lib/daily-status.ts` 動態狀態 chip（今日發文 / 昨日發文 / 停更 N 天 / 長時間停更 / 鐵人煉成 / 已刪文），SSR 與 client 共用同一判定，天數細節放 tooltip。
- [x] **Favorites / tracking specific series**（完成 2026-08-06）：localStorage 書籤（系列 ID 跨年度共用），卡片星號 toggle（grid/list 皆可），「我的收藏」分頁沿用排序器，空狀態引導；僅限本裝置/瀏覽器。
- **Real-time updates**: 近即時已是當前架構終點——Cloudflare Worker cron 每 10 分鐘批次更新 + 60s client refresh（2026-08-06 起）。真 near-real-time 需外部推送（WebSocket/SSE）或縮短 cron 間隔，屬成本 vs 即時性取捨，超出零成本約束；暫不排程。

### Already covered, no action needed

- **Series count keeps growing during signup period**: the scraper does a full sweep each run, so this is automatic.

## Accessibility & Inclusion

- Must support light + dark themes (user-confirmed): auto via `prefers-color-scheme` + manual toggle persisted (recommended pattern).
- Responsive (mobile-first) per original spec.
- No product-specific regulatory/a11y standard established beyond this.
