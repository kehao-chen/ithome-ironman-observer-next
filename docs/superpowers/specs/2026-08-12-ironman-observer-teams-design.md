# Design: 團隊計分板與狀態警示（Team Scoreboard）

> Status: Approved 2026-08-12（brainstorming 流程）。
> Follows the competition-board design system（`design-system.css`）。
> Scope: iThome 鐵人賽的「組團」現象——20 系列（6 隊）隸屬團隊（2026-08-11 快照，`data/2026.json`）。

## Problem

iThome 鐵人賽除了單人參賽，還有**組團**：多位參賽者以同一團隊名報名，成員各自開系列、可跨組別。目前 `team` 欄位已在抓取（`scripts/types.ts` 的 `Series.team`），UI 只在卡片 meta 顯示被動文字「團隊 {名稱}」，搜尋也命中團隊名——**資料有了，但「團隊」這個參賽單位完全沒有被呈現**。

觀察：團隊成員跨組別（「五人成行，Bug 不行」5 人分屬 Software Development / ChatGPT & Codex / Vibe Coding / Build on Google AI 四組）、跨進度（「不買股票買機票」4 人全數尚未開賽）、跨狀態（「身為一道彩虹」1 人 day 10、1 人 day 1 停更 9 天、1 人未開賽）。團隊是**獨立於組別的維度**，現有 dashboard 沒有任何視圖能回答「哪隊跑得最遠、哪隊今天誰沒發文」。

## Goal

新增「團隊計分板」視圖：把團隊當作參賽單位，呈現總瀏覽（團隊分數）、人均、平均進度、今日發文率，並標示**落後警示**（今日缺發 / 停更 / 未開賽）。零後端、純 client-side（聚合資料全部現成）、與既有組別/收藏分頁同級的獨立視圖。

## Non-Goals

- **不做跨年度團隊**——計分板跟隨年度切換器，只算目前年度資料（收藏分頁的跨年度語意是「系列 ID 跨年度共用」，團隊無此需求；目前僅一年資料）。
- 不做團隊排名「複合計分」——健康指標（今日發文率/警示）只是資訊列，不進主排序（避免規則複雜化）。
- 不做團隊間比較的圖表（bar chart 等）——YAGNI，6 隊用表列即可。
- 不改 scraper / `data/` shape / 型別——`team` 已在抓，聚合純 client-side。
- 不做「團隊人數排行」「團隊平均瀏覽對比」等額外指標——列上已有，多餘。
- 不改 RSS modal / Insights 分頁 / 收藏邏輯。

## 1. 資料層（`web/src/lib/teams.ts`，純函式）

### 1.1 聚合

```ts
type TeamMemberRow = {
  series: ViewSeries;       // 完整系列（可直接餵 cardViewModel）
  views: number;            // 成員總瀏覽（totalViewsOf 語意）
  status: StatusChip;       // 既有 daily-status 判定（今日發文/昨日/停更/長時間停更/已刪文/完賽/尚未開賽）
  staleDays: number | null; // 停更天數（null = 無法判定）
  isPending: boolean;       // dayCount === 0 且非已刪文
};
type TeamRow = {
  name: string;
  members: TeamMemberRow[];
  memberCount: number;
  totalViews: number;       // 成員 views 求和
  avgViews: number;         // 總瀏覽 ÷ 人數
  avgProgress: number;      // 成員 dayCount 平均（cap 30）
  postedToday: number;      // 今日發文成員數
  staleCount: number;       // 停更（≥2 天）成員數
  pendingCount: number;     // 未開賽成員數
  alertSummary: string | null; // 見 §1.3
  hasAlert: boolean;        // 有警示才標色（§2.2）
};

export function aggregateTeams(data: YearData, today: string): TeamRow[];
export function teamNames(data: YearData): string[]; // 年度切換時檢查 team: chip 存在性
export function sortTeamRows(rows: TeamRow[], key: TeamSortKey): TeamRow[]; // 見 §1.2
```

- `aggregateTeams` 輸入 `YearData` + `today`（臺北日，呼叫端傳入——SSR 用 build 時點、client 用 runtime，與 `cardViewModel` 同模式）。`today` 用於「今日發文」與警示判定，必須與主卡片同一基準。
- **排序**：`aggregateTeams` 回傳依 `totalViews` desc 排序的榜單（主排序預設值）。排序鍵切換（§2.3）由 `sortTeamRows` 純函式處理（同 `sortSeries` 模式：`[...rows].sort` 副本，不 mutate、不改變輸入）。
- 空資料年度（無任何系列帶 team）→ `[]`（UI 顯示空狀態，§2.4）。
- 成員 views 用 `totalViewsOf`（`sumViews ?? articles 求和`）——compact 資料相容。

### 1.2 排序鍵

`TeamSortKey` 型別：`"totalViews" | "avgViews" | "avgProgress" | "postedToday"`。`sortTeamRows(rows, key)` 依鍵排序：

| 鍵 | 語意 | 排序 |
|---|---|---|
| `totalViews` | 團隊總瀏覽 | desc（主排序預設） |
| `avgViews` | 人均瀏覽 | desc |
| `avgProgress` | 平均進度（cap 30） | desc |
| `postedToday` | 今日發文數（postedToday，非比率） | desc |

平手（比較鍵相等）→ 團隊名 `localeCompare("zh-Hant")`（穩定、可測）。4 鍵皆為 `TeamRow` 純欄位，無需重算；「今日發文」排序鍵用 `postedToday` 計數（比率與計數排序等價，計數更直覺）。

### 1.3 警示分類（互斥）

每隊成員分類，**互斥、不重疊**（避免摘要「今日缺發 3 人 · 停更 2 人」中同一人重複計數）：

1. **未開賽**：`dayCount === 0` 且非已刪文（`isPending`）。成員狀態 chip 顯示「尚未開賽」（`statusChip` 天然處理）。
2. **停更**：有最新文章（`staleDays !== null`）且 `staleDays >= 2`。「昨日發文」（staleDays === 1）**不罰**（與 `daily-status` 的 `stale` 語意一致）。
3. **今日缺發**：有最新文章且 `staleDays === 1`（昨日有發、今日未發）。**停更者不重複計入**今日缺發。

`staleDays` 計算：`stalenessDays(latest.publishedAt, today)`（既有函式；null = 無文章或缺陷日期 → 不落入任何警示類別）。已刪文成員：警示不計入（非缺發非停更非未開賽，狀態 chip 顯示「已刪文」）。

`alertSummary` 由非零類別組裝（mono 文字、muted）：
- `今日缺發 1 人 · 停更 2 人`（今日缺發、停更皆 >0）
- `未開賽 4 人`（僅未開賽）
- 全健康（三者皆 0）→ `null`（不顯示摘要，列不加警告色）

`hasAlert` = `alertSummary !== null`。

## 2. UI 與互動

### 2.1 入口（filter 列）

組別 filter 列最前方、**「我的收藏」之前**新增「團隊計分板」chip（`data-group="teams"`，計數 = 團隊數，SSR 計算；與收藏 chip 同級）。點擊切換到計分板視圖（隱藏系列卡片流），再點任一組別/收藏 chip 回到系列流。

```html
<button data-group="teams" class="filter-btn" data-active="false">
  <span class="filter-label">團隊計分板</span>
  <span class="filter-count tabular-nums">6</span>
</button>
```

計分板視圖下：**搜尋 input、排序 select、視圖切換器（grid/list）整列隱藏**（計分板有自己的表頭排序，不與主排序器衝突；搜尋 query 保留，回到系列流不丟失）。

### 2.2 計分板視圖

`#series-list` 隱藏，改顯示 `<div id="teams-board">`（計分板容器，SSR 靜態輸出骨架、預設 `hidden`，行由 client 填入——計分板是第二視圖非 filter 子集，不 SSR 渲染行）。

榜單結構（每隊一列）：

```
[展開▸] 團隊名             成員 5 │ 總瀏覽 4,263 │ 人均 853 │ 進度 9.8/30 │ 今日 4/5 │ ⚠ 今日缺發 1 人
```

- 表頭列：可排序欄位（團隊名不排）｜成員｜總瀏覽｜人均｜平均進度｜今日發文｜警示（資訊列，不排序）
- 排序按鈕：點表頭切換排序鍵（`aria-sort` 標示目前鍵與方向）；排序鍵切換 → 重排榜單（client 純函式 `sortTeamRows`）
- **警示標色**：`hasAlert` 的團隊列加 `warning` 色左邊框 + `warning-weak` 底（比 §1.1 的 `hasAlert` 更響；完全健康列不加色）
- 每列可展開（`<details>`/按鈕 toggle，`aria-expanded`）：展開顯示**成員清單**——作者、組別、進度 n/30、瀏覽、狀態 chip（今日發文/停更中/已刪文/尚未開賽，**與主卡片同一套 `statusChip` 判定**，零新增邏輯）、停更天數 tooltip
- 展開列底部「看該隊系列」按鈕 → 切回主視圖並把 filter 設為該隊（`data-group="team:五人成行"`，見 §2.5）

### 2.3 排序

計分板視圖預設 `totalViews` desc。表頭可點擊切換：總瀏覽 / 人均 / 平均進度 / 今日發文率（4 鍵，§1.2）。排序狀態為計分板視圖內狀態（與主視圖排序器獨立，不互相污染）。

### 2.4 空狀態

年度無任何團隊（`aggregateTeams` 回傳 `[]`）：計分板視圖顯示空狀態（同收藏空狀態風格：「這個年度還沒有團隊報名」）。計分板 chip 計數顯示 0，**不隱藏 chip**（與收藏分頁同語意——視圖永遠存在，內容可空）。

### 2.5 「看該隊系列」團隊 chip

計分板視圖的團隊列展開後「看該隊系列」→ 切回主視圖（`#teams-board` 隱藏、`#series-list` 顯示），filter 設為該隊：

- `data-group="team:五人成行"`（`team:` 前綴，與組別/`fav` 同 namespace）
- active 樣式與組別 chip 一致
- **年度切換**：若新年度無此隊（`teamNames(data)` 不含）→ fallback「全部」（同 `activeGroupFor` 語意，`activeGroupFor` 需擴充認識 `team:` 前綴）
- 此視圖沿用主排序器、搜尋可用（團隊系列流 = 該隊成員的系列卡片，套用主排序器——你已確認）
- 團隊系列流狀態列分母 = 該隊成員數

## 3. Client 狀態與流程（Dashboard.astro script）

- 新增模組級 state：`view = "series" | "teams"`（預設 `"series"`）。
- `applyFilter` 管線擴充：
  - `group === "teams"` → 切換到計分板視圖（隱藏 `#series-list`、顯示 `#teams-board`、隱藏搜尋/排序/視圖切換器；query 保留）
  - `group` 以 `team:` 前綴 → `series = series.filter((s) => s.team === group.slice(5))`，其餘管線（搜尋 → 排序）照舊
  - 其餘 → 現行管線不變
- 計分板渲染：`aggregateTeams(data, today)` → 依目前排序鍵 `sortTeamRows` → `buildTeamRow`（`teams-dom.ts`）填入 `#teams-board`。
- `render(data)`（年度切換 / 60s refresh）：計分板視圖下重聚合；`team:` chip 若新年度無此隊 → fallback「全部」。
- 計分板視圖下 60s refresh：`today` 週期校正照舊（`setInterval` 現有邏輯），render 時以最新 `today` 重聚合。
- 警示摘要 / 成員 chip 與主卡片共用 `statusChip`（`daily-status.ts`），**無第二套判定**。

## 4. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `web/src/lib/teams.ts` | **新增**：`aggregateTeams` / `teamNames` / `sortTeamRows` / 型別（純函式，單元測試對象） |
| `web/src/lib/teams.test.ts` | **新增**：單元測試（Bun test，模式同 `filter.test.ts`） |
| `web/src/lib/teams-dom.ts` | **新增**：`buildTeamRow`（榜單列 + 展開成員）DOM 建構（happy-dom 可測，模式同 `card-dom.ts`） |
| `web/src/lib/teams-dom.test.ts` | **新增**：DOM 結構契約測試 |
| `web/src/lib/filter.ts` | 擴充：`team:` 前綴組別過濾 + `activeGroupFor` 認識 `team:`（fallback 語意）；既有測試保持綠 |
| `web/src/lib/filter.test.ts` | 增補：`team:` 過濾 / 年度 fallback 測試 |
| `web/src/components/Dashboard.astro` | 新增計分板 chip + `#teams-board` 容器 + `view` state + 視圖切換 + 排序表頭 + 「看該隊系列」邏輯 + 計分板視圖下搜尋/排序/視圖切換器隱藏 |
| `web/src/styles/design-system.css` | `.teams-board` / `.team-row` / 警示色列 / 展開 / 表頭排序 / 成員列樣式（沿用 token：`--warning` / `--warning-weak` / `--surface` / `--border` / `--font-sans`） |
| `README.md` | **實作後同步更新**：Features 行加 Teams；本 spec commit 不含 README 變更 |
| `PRODUCT.md` | roadmap 加 Teams 候選並標記完成（實作後） |

不改：`scripts/`（scraper 零變動）、`daily-status.ts`（判定已足夠）、`card.ts`（`ViewSeries` 已有）、`SeriesCard.astro`（卡片不加團隊連結——展開列已是入口）、`data/` shape、`.github/workflows/`、RSS modal、Insights 分頁。

## 5. 測試策略

### 5.1 單元（`web/src/lib/teams.test.ts`，Bun test）

- 聚合數值：總瀏覽 / 人均 / 平均進度（cap 30）/ 今日發文數 / 成員數正確。
- 警示分類互斥：staleDays === 1 → 今日缺發；≥2 → 停更；day 0 → 未開賽；同一成員只落一類。
- `alertSummary` 組裝：今日缺發+停更 → `今日缺發 N 人 · 停更 M 人`；僅未開賽 → `未開賽 N 人`；全健康 → null。
- 四種排序鍵 + 平手 tie（隊名 zh-Hant localeCompare）。
- compact 輸入（sumViews + 單篇 latest）與完整輸入聚合結果一致（`totalViewsOf` 語意）。
- 缺陷日期（publishedAt 非臺北日格式）→ 不落入警示類別；已刪文成員不計入警示。
- 空 series / 無 team → `[]`。
- 真實資料 sweep（`data/2026.json`）：6 隊、20 成員、聚合數值與手算一致。

### 5.2 DOM 契約（`web/src/lib/teams-dom.test.ts`，happy-dom）

- 榜單列骨架（展開 toggle、成員數、四欄位值、警示色 class、表頭排序按鈕、成員列 chip）。
- 展開/收合 toggle、`aria-expanded`。
- 警示摘要 textContent 正確。

### 5.3 Build / 型別

- `bunx tsc --noEmit` 乾淨；`bun test` 全綠（既有 + 新增）。
- `bun run build` 成功。

### 5.4 手動 headless browser

1. 載入：計分板 chip 出現（filter 列最前方、計數 = 團隊數）。
2. 點計分板 chip → 切換到榜單（系列卡片隱藏）；搜尋/排序/視圖切換器隱藏；狀態列顯示團隊數。
3. 榜單排序：點表頭切換排序鍵，`aria-sort` 反映。
4. 展開團隊列 → 成員清單（作者/組別/進度/瀏覽/狀態 chip）；「看該隊系列」→ 切回主視圖、filter 設為該隊、套用主排序器。
5. 警示色列：`hasAlert` 隊加警告色，健康隊無色；警示摘要文字正確。
6. 年度切換：計分板視圖下換年 → 重聚合；`team:` chip 新年份無此隊 → fallback「全部」。
7. 無團隊年度 → 空狀態（計分板視圖顯示「這個年度還沒有團隊報名」）。
8. 搜尋 query 在計分板視圖與系列流間保留。
9. 無 console error。

## 6. 風險

- **聚合一致性**：計分板警示與主卡片狀態 chip 共用同一 `statusChip` 判定（`daily-status.ts`），無第二套邏輯——drift 風險為零。
- **`today` 基準**：警示「今日」= 現時刻臺北日（`taipeiToday()`），與主卡片「今日發文」chip 同源；跨日由現有 60s 週期校正處理。
- **compact 資料**：計分板只需最新一篇（`statusChip` 只看 latest）+ 總瀏覽（`totalViewsOf` 用 sumViews）——無需完整 articles，與現有 60s refresh 相容。
- **警示類別互斥**：今日缺發 = staleDays 1（昨日有發、今日未發）收窄定義，避免與停更（≥2）重疊計數——spec §1.3 釘死。
- **`team:` 前綴命名空間**：`activeGroupFor` 與組別/`fav` 共用，需擴充認識前綴；fallback「全部」語意與現有組別一致。
- **計分板視圖狀態獨立**：排序鍵、展開狀態為計分板視圖內狀態，不與主視圖排序器互相污染；視圖切換後返回不丟失（模組級 state）。

## 7. 決策記錄

- **排名基準（複合計分板）**：總瀏覽主榜 + 人均/平均進度/今日發文率資訊列。不用「複合計分」（健康指標加權進排名）——排序規則要保持可解釋，量測儀器不做黑箱。
- **警示基準**：停更 ≥2 天（昨日發文不罰）；今日缺發收窄為 staleDays === 1（與停更互斥）。未開賽獨立分類。
- **入口**：與收藏同級的獨立視圖（filter 列 chip），非頁面頂部常駐區塊（6 隊不值得常駐占版面）、非折疊區塊（計分板是主要視圖之一）。
- **視圖深度**：榜單 + 可展開成員 +「看該隊系列」入口（展開成員列 + 切到該隊系列流）。不做「點擊團隊名跳轉」單一入口。
- **排序**：多欄位表頭排序（4 鍵），非固定單鍵。
- **跨年度**：跟隨年度切換器，不跨年度（收藏分頁語意不相容）。
- **無團隊年度**：顯示空狀態，不隱藏 chip。
