---
version: 1
slug: "web-src-pages-index-astro"
primary_target: "web/src/pages/index.astro"
related_targets: []
---

# 鐵人觀察家 2026 — Dashboard Surface Brief

**Scope:** Single-page dashboard (`web/src/pages/index.astro` → `Dashboard.astro`).
**Visitor mode:** Operate.

## Audience & Job
- Primary: people following the 2026 iThome Ironman (Taiwan tech blogging event), likely readers/authors, revisiting repeatedly.
- Job: quickly grasp daily article dynamics across ~127 series / 17 groups; find which series are active, popular, and their latest article.

## Task / Action
- Browse by group (filter chips) + sort (progress / most views / latest).
- Scan series cards for: title, author, group, DAY progress, views, latest article, updated time.
- Client-side refresh every 60s (no full reload).

## Proof / Content
- Live data from `data/2026.json` (SSG pre-render + client fetch).
- Cards show real views/likes/comments; DAY badge unified (client + static both show 尚未開賽 for 0-day, never `DAY ?`).

## Constraints
- Zero-cost (static, no backend/db). Browser UA for scraping (unchanged).
- `textContent` only for user data (XSS); entity-decoding at parse time.
- Light + dark theme (auto + manual toggle persisted).

## Chosen Direction
- **示波器訊號台 (Oscilloscope Signal Bench)** — fused from impeccable roll C4 (`scientific-notation-oscilloscope-signal-bench`).
- Phosphor green accent on near-black glass (dark default), graticule grid, condensed mono instrument caps, flat panels with accent glow on hover, per-series progress trace (mini sparkline).
- Design system: `DESIGN.md` (root) + `web/src/styles/design-system.css` + `.impeccable/design.json`.

## Memorable Moment
- A series card's phosphor trace rising across the graticule as its DAY progress grows — the "signal" of the competition made visible.

## Unresolved Decisions
- None blocking: direction + design system approved.
