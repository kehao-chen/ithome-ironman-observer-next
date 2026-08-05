---
name: 鐵人觀察家 2026
description: 2026 iThome 鐵人賽每日觀察儀表板 — 示波器訊號台
colors:
  bg: "#07090d"
  bg-elevated: "#0b0e13"
  surface: "#0d1117"
  surface-muted: "#131a23"
  line: "#1c2430"
  line-strong: "#2c3a4d"
  accent: "#33ff66"
  accent-hover: "#66ff99"
  accent-weak: "#0f2a1a"
  graticule: "#2a3542"
  text: "#d7e3d9"
  text-secondary: "#9fb3a8"
  muted: "#5d6b62"
  warning: "#ffb84d"
  warning-weak: "#33230d"
  success: "#33ff66"
  on-accent: "#04120a"
  bg-light: "#f4f6f8"
  surface-light: "#ffffff"
  surface-muted-light: "#e9edf2"
  line-light: "#dde3ea"
  line-strong-light: "#c2ccd8"
  accent-light: "#0f8a3d"
  accent-hover-light: "#0a6e30"
  accent-weak-light: "#dff3e6"
  text-light: "#18211c"
  text-secondary-light: "#45534b"
  muted-light: "#6b7a70"
  warning-light: "#9a5b00"
  warning-weak-light: "#f9ecd8"
  on-accent-light: "#ffffff"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  label:
    fontFamily: "'Noto Sans Mono CJK TC', 'SF Mono', ui-monospace, 'Cascadia Code', Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0"
  instrument:
    fontFamily: "'Noto Sans Mono CJK TC', 'SF Mono', ui-monospace, 'Cascadia Code', Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
  7: "48px"
  8: "64px"
components:
  filter-chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  filter-chip-active:
    backgroundColor: "{colors.accent-weak}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  sort-select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  series-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  day-badge:
    backgroundColor: "{colors.accent-weak}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  day-badge-pending:
    backgroundColor: "{colors.warning-weak}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  day-badge-done:
    backgroundColor: "{colors.accent-weak}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
---

# Design System: 鐵人觀察家 2026

## Overview

**Creative North Star: "示波器訊號台" (The Oscilloscope Signal Bench)**

一台監看 2026 iThome 鐵人賽訊號的示波器。每個參賽系列是一條 phosphor trace，在蝕刻的 graticule（十格 = 30 天賽程）上上升；組別是通道群組；瀏覽數/Like/留言是 readout。使用者是技術讀者，來這裡「接上探棒、看訊號」——哪條 trace 在動、哪條停了、哪條最強。這不是一個被裝飾的儀表板，而是一台**量測儀器**：Operate mode，掃讀效率與資料密度是最高指導。

系統建立在 impeccable craft-floor 之上：phosphor green on near-black（dark 預設，模擬示波器玻璃）、graticule 灰蝕刻網格、condensed mono instrument caps 與 seven-segment readout 語彙、detented knob 的觸覺對應（filter/sort 的明確狀態）。Light theme 是「日光下的儀器玻璃」——不犧牲語彙，只換 ground。Restrained 色彩策略：phosphor green 單一 accent，amber 保留給 armed/warning（尚未開賽），traces 是資料，不是裝飾。

**Key Characteristics:**
- Dark 預設（phosphor glass），light 為「日光下的玻璃」；auto（`prefers-color-scheme`）+ manual toggle（localStorage 持久化）
- Phosphor green 單一 accent，amber 只給 armed/warning
- Graticule 網格（卡片內嵌 10-division 刻度感）、condensed mono instrument caps、tabular-nums
- Flat panels（1px hairline + tonal layering），hover 才浮起（+ accent 邊框）
- 每系列一條 progress trace（DAY 進度迷你 sparkline）
- Mobile-first，grid over flex-math，`min-h-[100dvh]`

## Colors

Phosphor green on near-black glass（dark 預設）；light 是日光下的儀器玻璃。單一 accent 是稀有資源。

### Primary
- **Phosphor Green** (`#33ff66` / light `#0f8a3d`): 唯一的強調色。traces、連結、focus ring、DAY badge 文字、active filter。**The Rarity Rule: accent 用在 ≤10% 版面，稀有是重點。**

### Neutral
- **Glass** (`#07090d` / light `#f4f6f8`): body 背景（近黑玻璃 / 日光灰）。
- **Panel** (`#0d1117` / light `#ffffff`): 卡片、header、select。
- **Panel Muted** (`#131a23` / light `#e9edf2`): hover、pressed。
- **Graticule** (`#2a3542` / light `#e2e8ee`): 蝕刻網格灰。
- **Line** (`#1c2430` / light `#dde3ea`): hairline border。
- **Line Strong** (`#2c3a4d` / light `#c2ccd8`): 強調 border。
- **Text** (`#d7e3d9` / light `#18211c`): 主要文字。
- **Text Secondary** (`#9fb3a8` / light `#45534b`): 次要。
- **Muted** (`#5d6b62` / light `#6b7a70`): meta、時間。

### Semantic
- **Amber** (`#ffb84d` / light `#9a5b00`): armed/warning——尚未開賽、警示。**The Amber Discipline: amber 只給 armed/warning，不當第二 accent。**
- **Success** (`#33ff66` / light `#0f8a3d`): locked/live——完賽、資料已更新。

## Typography

**Display Font:** system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif
**Body Font:** 同上
**Label/Mono Font:** "Noto Sans Mono CJK TC", "SF Mono", ui-monospace, "Cascadia Code", Menlo, monospace

**Character:** 標題/內文用系統 sans + Noto Sans TC（工作馬、清晰）；**儀器標籤（filter、badge、meta、時間）用 mono**，呼應示波器的 instrument caps 與 seven-segment readout。mono 用於資料/測量語義，不是「技術感」裝飾。

### Hierarchy
- **Display** (700, 1.5rem, 1.25): 頁面標題（header brand）。
- **Headline** (600, 1.25rem, 1.4): 區塊標題。
- **Title** (600, 0.9375rem, 1.4): 卡片標題（series title）。
- **Body** (400, 0.9375rem, 1.6): 內文、卡片 meta。max line length 65–75ch。
- **Label** (400, 0.8125rem, 1.4): 一般標籤。
- **Instrument** (700, 0.75rem, 1.25, +0.04em): 儀器標籤——DAY badge、filter、meta、時間、readout。mono。

### Named Rules
**The Tabular Numerals Rule.** 所有資料數字一律 `font-variant-numeric: tabular-nums`，讓 readout 對齊。
**The Instrument Mono Rule.** mono 只給儀器標籤（資料/測量），不用於長文或標題。

## Layout

- **Container:** max-width 1200px，`margin-inline: auto`，mobile `padding-inline: 16px`、desktop `24px`。
- **Grid:** series 用 CSS Grid——`1fr`（mobile）→ `2fr`（≥640px）→ `3fr`（≥1024px）。禁 flex percentage math。
- **Header:** sticky，`min-height: 60px`，blur backdrop，`border-bottom: 1px solid var(--line)`。brand 前有 phosphor dot。
- **Spacing rhythm:** 4/8/12/16/24/32/48/64。緊群組（卡片內 `gap: 4px`）、寬分隔（卡片間 `gap: 12px`）。heading 上方空間 > 下方。
- **Density:** 資料密集但留白充足；`min-h-[100dvh]`（禁 `h-screen`）。

## Elevation & Depth

**Flat panels by default.** 卡片用 1px hairline border + tonal layering 建立深度，**無常駐 shadow**。Shadow 只在狀態回應出現（hover / focus），且 hover 時配 **accent 邊框**（模擬示波器 channel 選中時 channel 亮起）。

### Shadow Vocabulary
- **Hover** (`box-shadow: 0 4px 20px rgba(0,0,0,0.6)` + `0 0 0 1px accent 30%`): 卡片 hover 浮起 + accent 描邊。
- **Focus** (`outline: 2px solid var(--accent); outline-offset: 2px`): 鍵盤 focus ring。

## Shapes

- **Panel radius:** 8px（`--radius-lg`）。示波器面板是方正的，微圓角。
- **控制 radius:** select/input 6px（`--radius-md`）；filter chip pill（999px）。
- **小控制 pill、面板 8px、輸入 6px** 是有文件的三級規則：pill 只給小控制（DAY badge、filter chip）。
- 卡片不用大 radius（禁 20px+）、不用 shadow 疊 border（hover 的 accent 描邊是語彙，不是 ghost card）。

## Components

### Buttons / Filter Chips
- **Shape:** pill (999px)。
- **Default:** transparent bg、`--text-secondary` text；hover `--panel-muted` bg + `--text`。
- **Active:** `--accent-weak` bg + `--accent` text + 35% accent border + weight 600。表示當前篩選（channel 亮起）。

### Select / Icon Button
- **Shape:** 6px radius。
- **Style:** `--panel` bg、1px `--line-strong` border、`--text` text；hover border 轉 accent。
- **Focus:** focus ring（outline accent）。

### Series Cards（Panels）
- **Corner Style:** 8px。
- **Background:** `--panel`。
- **Shadow Strategy:** flat at rest；hover 浮起 + accent 描邊（見 Elevation）。
- **Border:** 1px `--line`；hover 轉 `--accent`。
- **Internal Padding:** 16px；grid `auto 1fr`（DAY badge + 內容）。

### Day Badge（Channel Readout）
- **Style:** pill、mono instrument caps、`--accent-weak` bg + `--accent` text、weight 700、tabular-nums、inset accent 描邊。
- **State:** `DAY {n}`（進行中）用 accent；`尚未開賽` 用 amber（armed）；完賽（30 天）用 success。**統一 client/static 渲染**（都顯示 `尚未開賽`，不用 `DAY ?`）。

### Progress Trace
- **Style:** 每系列卡片底部一條 mini sparkline（`<svg>`），X = DAY、Y = 每日 views/Like 趨勢。用 accent stroke，呼應 phosphor trace。

### Status Bar（Instrument Readout）
- **Style:** mono、`--muted` text、phosphor dot 表示「資料已更新」、tabular-nums 對齊計數。

## Do's and Don'ts

### Do:
- **Do** 用 phosphor green 單一 accent，≤10% 版面。
- **Do** 用 system-ui + Noto Sans TC（標題/內文）+ mono（儀器標籤）。
- **Do** 資料數字用 `tabular-nums`。
- **Do** 卡片 flat at rest，hover 才浮起 + accent 描邊。
- **Do** 面板 radius 8px、小控制 pill。
- **Do** dark 預設（phosphor glass）+ light（日光玻璃），`prefers-color-scheme` + manual toggle 持久化。
- **Do** 原生瀏覽器表面（scrollbar/selection/caret/focus/tabular numerals）從 palette theme。
- **Do** 每系列配 progress trace（DAY 進度迷你 sparkline）。

### Don't:
- **Don't** 用 Inter 或其他 display face（中文用 Noto Sans TC；儀器用 mono）。
- **Don't** 用 emoji 當 icon（換成簡約 SVG，統一 stroke）。
- **Don't** 用 gradient text、glass/blur 當裝飾、colored border-left >1px。
- **Don't** 用 hard offset shadow 或 ghost card（border + shadow 並存）。
- **Don't** 用 monospace 當裝飾（只用於儀器標籤/資料/數字）。
- **Don't** 用 `innerHTML` 放使用者資料（一律 `textContent`，XSS 約束）。
- **Don't** 用 `h-screen`（用 `min-h-[100dvh]`）。
- **Don't** 用超過 3 個 accent 色或暖冷灰混用；amber 只給 armed/warning。
