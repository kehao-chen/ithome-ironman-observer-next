# 鐵人觀察家 2026 — 賽事觀察板 redesign

- **Date:** 2026-08-05
- **Status:** Approved → implemented
- **Supersedes:** oscilloscope signal-bench direction (rolled back post-deploy: metaphor too abstract, progress trace read as noise)
- **Stack:** Astro 5, vanilla JS, zero-cost static (GH Actions + Cloudflare Pages). Unchanged.

## Why redesign

Deployed oscilloscope direction failed on legibility:

1. **Progress trace carried no intent.** `SeriesCard.astro` rendered a hardcoded polyline identical on every card (the client `renderCard` later computed a real views-sparkline, but SSR served a fake one). Either way it read as decorative noise, not "day progress".
2. **Filter had no affordance.** Inactive `.filter-btn` was `transparent` on `transparent` → a 17-group list rendered as an undifferentiated text wall.

Direction pivot: **賽事觀察板 (Competition Board)** — treat the dashboard as a scoreboard for a 30-day writing marathon. Every element must read at a glance.

## Design decisions (user-approved)

- **Direction:** 賽事觀察板 — ranked list, big tabular numerals, progress = the marathon score.
- **Palette:** 沉穩藍 — neutral base + blue accent. Clean break from phosphor green.
- **Card progress:** real `dayCount/30` bar (the fix for the fake trace).
- **Filter:** visible chips with per-group counts.

## Tokens

| token | Light | Dark |
|---|---|---|
| `--bg` | `#f7f8fa` | `#0f1115` |
| `--surface` (cards) | `#ffffff` | `#181b22` |
| `--surface-muted` (chip idle) | `#eef1f5` | `#1f232c` |
| `--text` / `--muted` | `#1a1f2e` / `#6b7280` | `#e5e7eb` / `#9ca3af` |
| `--accent` (progress / active / link) | `#2563eb` | `#3b82f6` |
| `--accent-weak` | `#eff6ff` | `rgba(59,130,246,.16)` |
| `--success` (完賽) | `#16a34a` | `#22c55e` |
| `--warning` (尚未開賽) | `#d97706` | `#f59e0b` |
| `--warning-weak` | `#fff7ed` | `rgba(245,158,11,.16)` |
| `--border` | `#e5e7eb` | `#2a2f3a` |

Typography unchanged: `--font-body` = system-ui + Noto Sans TC (titles/body); mono stack for data labels/timestamps. `tabular-nums` on all numerals (scoreboard rule).

## Card

Single-column vertical stack (no `auto 1fr` split — that caused the blank-left issue). Structure (SSR `SeriesCard.astro` and client `renderCard` must stay in sync):

```
┌──────────────────────────────────────┐
│ DAY 2                        158 瀏覽 │  .card-head: badge (left) · total views (right, tabular)
│ ▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░  2/30  │  .progress: fill bar + n/30
│ AI工具革命 - 使用AI工作流打造簡報平台  │  .card-title (600)
│ toby_ya · Claude AI · 團隊 這不薄冰哥 │  .meta (muted, sm)
│ 最新  Day 02 – 現有的AI簡報模式       │  .info (link)
│ ╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴ │  border-top on .updated
│ 更新 14:55                           │  .updated (mono, xs, muted)
└──────────────────────────────────────┘
```

States (drive badge + fill color + fill width):

| dayCount | badge | fill color | width | label |
|---|---|---|---|---|
| 0 | `尚未開賽` (warning) | warning-weak track | 0% | `0/30` |
| 1–29 | `DAY n` (accent) | accent | `n/30 * 100%` | `n/30` |
| ≥30 | `完賽` (success) | success | 100% | `30/30` |

Fill width clamped to 100%. Total views = `sum(article.views)`.

## Filter

```
[全部 127] [AI Engineering 12] [Claude AI 24] [IT Operation 7] ...
```

- Chip: `1px border` + `surface-muted` background (idle) → clear affordance, no longer a text wall.
- Active: `accent-weak` fill + accent border + accent text.
- Per-group count (tabular, muted) computed from `series.filter(s => s.group === g).length`; `全部` = `series.length`.
- `flex-wrap`; 17 groups wrap naturally.
- Count is SSR-computed (refresh on full data update is acceptable — counts drift slowly).

## Unchanged

- RWD: 1 / 2 / 3 columns @ 640 / 768 / 1024.
- Theme toggle: auto → light → dark, `localStorage` persisted.
- Sort: 進度 (dayCount) / 最多觀看 (views) / 最新發布 (latest). Default 進度.
- Security: `textContent` only for user data; entity-decode at parse time.
- Native surfaces themed; reduced-motion respected.

## Out of scope

- Search, pagination, subscriptions stat, group grouping/collapsing. (YAGNI; filter chips + counts already address the menu complaint.)
