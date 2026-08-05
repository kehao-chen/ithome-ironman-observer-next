# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro 5 static site (`web/`), TypeScript shared with scraper (`scripts/types.ts`), native CSS with custom properties, no framework. Data pipeline: GH Actions cron → `bun run scripts/scrape.ts` → `data/2026.json` → Astro build → Cloudflare Pages. Zero-cost constraint (no paid backend/db; JSON is the DB).

## Users

People following the 2026 iThome Ironman competition (Taiwan tech blogging event). The user watches ~127 participating series across 17 categories and wants to quickly see daily article progress and popularity. Likely readers/authors, revisiting the site repeatedly to track the series they care about.

## Product Purpose

A dashboard that lets the user grasp the daily article dynamics of the 2026 iThome Ironman and browse/sort series by category. Success = the user can quickly answer "which series are active, which are popular, what's the latest article" without manual effort.

## Positioning

Recreation of qrtt1's original "ITHome 鐵人觀察家" (original went silent in 2024, not open-sourced) with the same core experience: an at-a-glance dashboard of daily article activity, browsable and sortable by group. Modernized, self-hosted, near-zero cost.

## Operating Context

- Scraper hits ithelp.ithome.com.tw (signup list + RSS + series pages), ~2 requests/series, ~250 requests/full sweep; **browser UA required** (403 otherwise).
- Cron: Taipei 07:00–01:00 hourly (18 runs/day, ~45 min/month; user-approved tradeoff vs full 24h).
- Data changes commit + deploy automatically; site refreshes client-side every 60s.
- UI is a single-page dashboard: category filter (tag row) + sort (progress / most views / latest) + series cards. Cards show: title, author, group, latest day, views, publish time, update time.
- `data/2026.json` is the DB; entity-decoding must happen at parse time (`html-entities.ts`), never client-side (double-escaping). Client DOM uses `textContent` only — `innerHTML` with user data is forbidden (XSS).

## Capabilities and Constraints

- Features: group filter, sort (dayCount / views / latest), client-side 60s refresh, responsive.
- Hard constraint: near-zero cost — GH Actions free tier + Cloudflare Pages free tier + own domain; no backend, no DB (JSON is the DB).
- Non-goals (v1): multi-year data, search, completion/active badges, login/favorites/tracking, real-time updates (periodic batch only).
- Browser UA mandatory for scraping; RSS/series page consistency verified.
- Known current UI issues (from handoff): all-inline styles, dark-only theme, no design system, `DAY ?` badge inconsistency, 30 zero-article series, placeholder filter style, mixed timestamp formats.

## Brand Commitments

- Name: 鐵人觀察家 (Ironman Observer), year 2026.
- Language: Traditional Chinese only (user-confirmed).
- Minimal wordmark identity: a simple text wordmark, overall tool-first aesthetic (user-confirmed).
- Original qrtt1 observer is the reference for the core experience (not visual identity).

## Evidence on Hand

- `data/2026.json` + `data/meta.json`: live scraped data (127 series / 17 groups, 2026-08-05).
- `docs/DEPLOYMENT-HANDOFF.md`: deployment + handoff record, known-issues list.
- `docs/superpowers/specs/2026-08-05-ironman-observer-next-design.md`: original design spec (approved).
- No logos/assets provided; no testimonials, benchmarks, or pricing claims exist and must not be fabricated.

## Product Principles

1. Data-first: the dashboard's job is scanability and comprehension; visual identity serves precision, not expression.
2. Near-zero cost is a hard constraint — no paid services, no backend, no DB.
3. Automation over manual ops: data changes commit and deploy themselves.
4. Preserve the core observer experience (grasp daily activity, browse by group) while modernizing the surface.
5. Non-goals stay out of v1: no search, no multi-year, no accounts.

## Roadmap

功能想法整理自 `docs/PROJECT-INTRODUCTION.md`（該檔待刪除，想法先保留下來）＋既有 non-goals。尚未排程，依價值/成本取捨後再決定。

### 短期可做（低成本、與現架構相容）

1. **多年度支援**：`data/2026.json` 已按年度命名，`config/series-manifest.json` 是年度清單（單一來源）。把 UI 加上年度切換即可服務往後屆次（原文件暗示此架構，PROJECT-INTRODUCTION 五節）。
2. **排序改進**：以「當日新增文章數」重新定義「最新發布」排序（現為該系列最後一篇文章時間，定義含糊；與 DEPLOYMENT-HANDOFF 已知問題 #6 相同）。
3. **scrapeLog 錯誤可見化**：單一系列失敗已寫入 `data/2026.json` 的 `scrapeLog`，但前端不顯示——可在頁面角落顯示「本次更新 N 系列失敗」與錯誤清單（PROJECT-INTRODUCTION 七節）。

### 中期候選（來自 v1 non-goals，做之前需重新評估價值）

- **搜尋**：依標題/作者/組別全文搜尋系列。
- **完賽 / 活躍 badge 強化**：目前只有 DAY 0 / 進行中 / 完賽三態，可加「今天有發文」「連續 N 天未更新」等動態狀態。
- **收藏 / 追蹤特定系列**：localStorage 收藏，首頁置頂或獨立分頁（無後端，零成本相容）。
- **即時更新**：目前為週期批次（每小時）+ client 60s refresh；真要接近即時需外部觸發（如 Cloudflare Worker cron）——成本與排程可靠性取捨。

### 已涵蓋、不需再做

- **報名期間系列數持續增加**：scraper 每次全量抓取，自動涵蓋（PROJECT-INTRODUCTION 三節）。

## Accessibility & Inclusion

- Must support light + dark themes (user-confirmed): auto via `prefers-color-scheme` + manual toggle persisted (recommended pattern).
- Responsive (mobile-first) per original spec.
- No product-specific regulatory/a11y standard established beyond this.
