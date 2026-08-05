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

Feature ideas carried over from the removed `docs/PROJECT-INTRODUCTION.md`, plus v1 non-goals. Not scheduled; prioritize by value/cost before building.

### Near-term (low cost, fits current architecture)

1. **Multi-year support**: `data/2026.json` is already year-named, and `config/series-manifest.json` is the per-year single source. A year switcher in the UI would serve future editions.
2. **Sort refinement**: redefine "latest" sort as "articles published today" (currently the last article's timestamp; definition is vague — same as DEPLOYMENT-HANDOFF known issue #6).
3. **Surface scrapeLog errors**: per-series failures are already written to `data/2026.json`'s `scrapeLog` but never shown in the UI — a corner notice like "N series failed this update" plus the error list would surface them.

### Mid-term candidates (from v1 non-goals; re-evaluate value before building)

- **Search**: full-text search of series by title/author/group.
- **Completion / activity badge enhancements**: currently only DAY 0 / in-progress / completed states; could add dynamic states like "posted today" or "no update for N days".
- **Favorites / tracking specific series**: localStorage bookmarks, pinned to top or a separate tab (no backend, zero-cost compatible).
- **Real-time updates**: currently periodic batch (hourly) + 60s client refresh; true near-real-time needs an external trigger (e.g., Cloudflare Worker cron) — a cost vs schedule-reliability tradeoff.

### Already covered, no action needed

- **Series count keeps growing during signup period**: the scraper does a full sweep each run, so this is automatic.

## Accessibility & Inclusion

- Must support light + dark themes (user-confirmed): auto via `prefers-color-scheme` + manual toggle persisted (recommended pattern).
- Responsive (mobile-first) per original spec.
- No product-specific regulatory/a11y standard established beyond this.
