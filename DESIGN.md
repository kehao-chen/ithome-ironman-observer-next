---
name: 鐵人觀察家 2026
description: 2026 iThome 鐵人賽每日觀察儀表板 — 賽事觀察板
colors:
  bg: "#0f1115"
  surface: "#181b22"
  surface-muted: "#1f232c"
  border: "#2a2f3a"
  text: "#e5e7eb"
  muted: "#9ca3af"
  accent: "#3b82f6"
  accent-weak: "rgba(59,130,246,0.16)"
  success: "#22c55e"
  warning: "#f59e0b"
  warning-weak: "rgba(245,158,11,0.16)"
  bg-light: "#f7f8fa"
  surface-light: "#ffffff"
  surface-muted-light: "#eef1f5"
  border-light: "#e5e7eb"
  text-light: "#1a1f2e"
  muted-light: "#6b7280"
  accent-light: "#2563eb"
  accent-weak-light: "#eff6ff"
  success-light: "#16a34a"
  warning-light: "#d97706"
  warning-weak-light: "#fff7ed"
typography:
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
components:
  filter-chip:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.muted}"
    borderColor: "{colors.border}"
    rounded: "{rounded.pill}"
  filter-chip-active:
    backgroundColor: "{colors.accent-weak}"
    textColor: "{colors.accent}"
    borderColor: "{colors.accent}"
    rounded: "{rounded.pill}"
  series-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  day-badge:
    backgroundColor: "{colors.accent-weak}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
  progress-fill:
    backgroundColor: "{colors.accent}"
---

# Design System: 鐵人觀察家 2026

> Authoritative source: `docs/superpowers/specs/2026-08-05-ironman-observer-competition-board-design.md`.
> Supersedes the oscilloscope signal-bench direction (rolled back post-deploy: metaphor too abstract, progress trace read as noise).

## Overview

**Creative North Star: "賽事觀察板" (Competition Board)**

把儀表板當作一場 30 天寫作馬拉松的計分板。每個參賽系列是一筆賽事紀錄：`DAY n/30` 進度條是「跑完多少」，總瀏覽是「分數」，最新文章是「今天交了什麼」。每個元素都要一眼看懂——這是一台給技術讀者掃讀的工具，不是被裝飾的藝術品。

**Key Characteristics:**
- Dark 預設 + light；auto（`prefers-color-scheme`）+ manual toggle（localStorage 持久化）
- 沉穩藍單一 accent（進度/選中/連結），綠 = 完賽，琥珀 = 尚未開賽
- 卡片單欄垂直堆疊：badge+總覽 → 進度條 → 標題 → meta → 最新 → 更新時間
- 真實進度條 `dayCount/30`（取代被詬病的裝飾性波形）
- 篩選 chip 帶邊框 + 底色 + 組別計數（取代透明純文字牆）
- tabular-nums（計分板數字對齊）

## Colors

沉穩藍 on 中性底。單一 accent 是稀有資源。

### Primary
- **Blue** (`#3b82f6` dark / `#2563eb` light): 唯一強調色。進度條 fill、active filter、連結、focus ring、DAY badge。**Rarity Rule: accent ≤10% 版面。**

### Neutral
- **BG** (`#0f1115` / `#f7f8fa`): body 背景。
- **Surface** (`#181b22` / `#ffffff`): 卡片、header、select。
- **Surface Muted** (`#1f232c` / `#eef1f5`): chip idle 底、progress track。
- **Border** (`#2a2f3a` / `#e5e7eb`): hairline。
- **Text / Muted** (`#e5e7eb`/`#9ca3af` · `#1a1f2e`/`#6b7280`).

### Semantic
- **Success** (`#22c55e` / `#16a34a`): 完賽（DAY ≥30）。
- **Warning** (`#f59e0b` / `#d97706`): 尚未開賽（DAY 0）。

## Typography

- **Body/Title:** system-ui + Noto Sans TC（清晰工作馬）。
- **Label/Mono:** ui-monospace stack，用於資料標籤、計數、時間、n/30。
- **The Tabular Numerals Rule:** 所有數字（瀏覽、計數、n/30、時間）一律 `font-variant-numeric: tabular-nums`。

## Layout

- **Container:** max-width 1200px，mobile `padding-inline: 12px`、desktop `24px`。
- **Grid:** 1fr（mobile）→ 2 col（≥640px）→ 3 col（≥1024px）。
- **Header:** brand（綠 dot + 字標）+ controls（filter chips + sort + theme toggle）。
- **Spacing rhythm:** 4/8/12/16/24/32。

## Elevation

Flat by default：1px border + tonal layering，無常駐 shadow。Hover 浮起（`--shadow-hover`）+ accent 邊框 + `translateY(-1px)`。Focus = 2px accent outline。

## Shapes

面板 10px（`--radius-lg`）；select/icon 6px；filter chip、DAY badge、progress track = pill 999px。三級規則：pill 只給小控制與進度軌。

## Components

### Filter Chips
- **Shape:** pill。
- **Idle:** `surface-muted` bg + `border` + `muted` text（有 affordance，非純文字）。
- **Active:** `accent-weak` bg + `accent` text/border。
- **Count:** 每個 chip 帶 tabular 組別計數 badge。

### Series Cards
- **Corner:** 10px。**Background:** surface。**Padding:** 16px。**Layout:** flex column。
- **Structure:** `.card-head`（DAY badge + 總覽）→ `.progress`（fill bar + `n/30`）→ `.card-title` → `.meta` → `.info`（最新 link + 當篇）→ `.updated`（border-top）。

### Day Badge + Progress
- DAY 0 = `尚未開賽`（warning）/ 空 warning-weak 軌。
- DAY 1–29 = `DAY n`（accent）/ accent fill = `n/30`。
- DAY ≥30 = `完賽`（success）/ success 滿條。
- Fill width 真實 encode `dayCount/30`，clamp 100%。SSR 與 client `renderCard` 必須同步。

### Status Bar
mono、`muted`、綠 dot「資料已更新」、tabular 計數。

## Do's and Don'ts

### Do
- 用沉穩藍單一 accent；綠/琥珀只給語意狀態。
- 資料數字一律 `tabular-nums`。
- 卡片 flat at rest，hover 才浮起。
- 篩選 chip 永遠有邊框+底色（affordance）。

### Don't
- 不用 Inter 或 display face（中文 Noto Sans TC；資料 mono）。
- 不用 emoji 當 icon（簡約 SVG）。
- 不用 gradient/glass 裝飾。
- 不用 `innerHTML` 放使用者資料（一律 `textContent`）。
- 不重新引入抽象比喻（示波器教訓：每個元素都要一眼看懂）。
