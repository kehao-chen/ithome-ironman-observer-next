# 鐵人觀察家 2026 — UI/UX 改版設計（示波器訊號台）

日期：2026-08-05
狀態：設計已批准（impeccable 流程：init → new-work → 骰子方向 C4 → 使用者選定）

## 背景

原站（2026-08-05 上線）為全 inline-style、暗色 only、無設計系統的 dashboard。使用者表達「UI/UX 整體蠻糟」，本設計決定完整視覺系統。

採用 impeccable skill（pbakaus/impeccable 4.0.4）流程：`init`（PRODUCT.md）→ `new-work`（視覺世界）→ `concept-seed` 骰子（ASSIGNED INDEX 5，挑戰者 C4 示波器融合在「audience identification + product clarity」兩軸勝出）→ 使用者選定 C4。

## 設計方向：示波器訊號台（The Oscilloscope Signal Bench）

一台監看 2026 iThome 鐵人賽訊號的示波器：

- 每個參賽系列 = 一條 **phosphor trace**，在蝕刻 **graticule**（十格 = 30 天賽程）上上升
- 組別 = **通道群組**
- 瀏覽數 / Like / 留言 = **readout**（seven-segment 語彙）
- 使用者是技術讀者，來「接上探棒看訊號」：哪條 trace 在動、哪條停了、哪條最強
- Operate mode：掃讀效率與資料密度是最高指導

### 色彩（Restrained）

- Dark 預設（phosphor glass）：`--bg:#07090d`、`--surface:#0d1117`、`--accent:#33ff66`（phosphor green）
- Light（日光下玻璃）：`--bg:#f4f6f8`、`--surface:#ffffff`、`--accent:#0f8a3d`
- 單一 accent（phosphor green），amber（`#ffb84d`）只給 armed/warning（尚未開賽）——**The Amber Discipline**
- **The Rarity Rule**：accent ≤10% 版面

### 字型

- 標題/內文：`system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`
- 儀器標籤（filter/badge/meta/時間/readout）：mono（`"Noto Sans Mono CJK TC", "SF Mono", ui-monospace, ...`）——**The Instrument Mono Rule**
- **The Tabular Numerals Rule**：所有資料數字 `tabular-nums`

### Elevation / Shapes

- Flat panels（1px hairline + tonal layering），hover 才浮起 + accent 描邊（channel 亮起）
- 面板 radius 8px、select 6px、pill 只給小控制（DAY badge、filter chip）
- 禁 ghost card（border + shadow 並存）

### Theme

- Dark 預設 + light（日光下玻璃）；`prefers-color-scheme` 自動 + 手動 toggle（localStorage 持久化）
- 三態：auto → light → dark → auto

## 落地檔案

| 檔案 | 角色 |
|---|---|
| `PRODUCT.md` | 產品真相（impeccable init 產物） |
| `DESIGN.md`（root） | 設計系統規範（detector allowlist + 8 節） |
| `.impeccable/design.json` | sidecar（shadow/motion/breakpoints/component snippets/narrative） |
| `web/src/styles/design-system.css` | token + component class + RWD + theme + native surfaces |
| `web/src/pages/index.astro` | 方向 contract（body 首 child HTML comment）+ 引入 CSS + theme script |
| `web/src/components/Dashboard.astro` | header/controls/filter/sort/status + client render（新 class） |
| `web/src/components/SeriesCard.astro` | 靜態卡片（新 class + progress trace） |

## 元件

- **Filter chip**：pill，active = accent-weak bg + accent text + 35% accent border
- **Series card**：8px panel，DAY badge + title + meta + latest + **progress trace**（mini sparkline）+ updated
- **Day badge**：pill、mono、accent（DAY n）/ amber（尚未開賽）/ success（完賽）；**統一 client + static**（不用 `DAY ?`）
- **Status bar**：mono readout、phosphor dot、tabular-nums
- **Theme toggle**：icon-btn，auto → light → dark 三態

## 已解決的 handoff 已知問題

1. 全 inline style → 收斂成 design-system class
2. DAY badge 不一致 → 統一（`尚未開賽`、無 `DAY ?`）
4. filter placeholder style → 正規 filter-btn
7. `ChatGPT & Codex` → mono instrument caps 正確顯示 `&`

## 驗證

- `bun test`：18 pass（scraper 單元測試未破壞）
- `bunx tsc --noEmit`：乾淨
- `cd web && bun run build`：成功，dist/ 產出
- impeccable detector（`detect.mjs --json web/dist/index.html`）：0 findings
- Headless browser 實測：127 卡片、filter（IT Operation→7 支、還原→127）、sort（views desc）、theme toggle 三態持久化、60s refresh 更新 updatedAt、無 console error、DAY badge 統一、`ChatGPT & Codex` 正確
- 方向 contract grep 存活於 built markup

## 未解決 / 待辦

- 像素級視覺檢驗（對比/間距/深度）需有 vision 的 session 或使用者檢視截圖（`/tmp/ironman-dashboard-dark.png`）
- 部署：改版 commit 後需手動觸發一次 `gh workflow run hourly-update` 讓線上站吃到新 UI
