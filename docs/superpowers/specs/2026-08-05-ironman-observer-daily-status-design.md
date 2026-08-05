# Design: 今日發文排序 + 卡片動態狀態（Daily Status）

> Status: Approved 2026-08-05. Follows the competition-board design system (`DESIGN.md`).
> Scope: near-term roadmap item 2 (sort refinement) + mid-term badge enhancement (today/stale states).

## Problem

- 「最新發布」排序目前等於「最新文章 timestamp」，語意含糊（handoff #6）：清晨或無人發文的日子，排序退化成同一天內的秒級先後，無法回答「哪些系列今天還活躍」。
- 卡片只有 DAY 0 / in-progress / completed 三種靜態狀態（roadmap mid-term），看不出「今天有發文」或「停更中」。
- 已知一致性問題（handoff #2）：SSR `SeriesCard.astro` 對 `dayCount === 0` 顯示 `DAY ?`，client `renderCard` 顯示 `尚未開賽` — 兩邊狀態運算各自為政。

## Goal

讓觀察者一眼回答「誰今天還在寫、誰停更了」，且排序與卡片狀態互相印證。零 scraper 變動，全 client-side。

## Non-Goals

- 不做「使用者本地日」：今日以**臺北日曆日**為準（鐵人賽是臺北本地賽事，offset 固定 `+08:00`，不隨瀏覽器時區漂移）。
- 不做「昨日發文」獨立狀態：昨天發文（N=1）是正常節奏，不顯示任何 chip（低噪音）。
- 不改 `latest` 的 option value（避免 URL/快取依賴），只改顯示文案。

## 1. 「今日」與停更天數的計算

`publishedAt` 全為 `+08:00` 牆鐘（RSS parse 已保留來源 offset）。因此：

```ts
// web/src/lib/daily-status.ts
// 視 +08:00 為固定 offset（來源保證），不解析時區；純字串層級取臺北日曆日。
export function taipeiDay(iso: string): string {
  return iso.slice(0, 10); // "2026-08-05"
}
export function taipeiToday(): string {
  // 現時刻 +08:00 的臺北日（與 taipeiTimestamp 同邏輯：先 shift 再取 ISO 日期）
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function stalenessDays(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null;                 // 無文章
  const day = taipeiDay(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null; // 非臺北日格式 → 不判定
  const diff = (Date.parse(today) - Date.parse(day)) / 86_400_000;
  return Number.isFinite(diff) && diff >= 0 ? Math.floor(diff) : null;
}
```

- 排序用 `taipeiDay(iso)` 字串比較（ISO 日期字典序 = 時間序），零 Date 解析。
- 天數差用 `Date.parse`（UTC 基準，但對純日期字串兩端都是 UTC 午夜，差即整數天，無時區問題）。
- **實作位置：`web/src/lib/daily-status.ts`（新檔案）**。放 `web/src/` 是為了 SSR（Astro component）與 client script 共用。單元測試同目錄 `daily-status.test.ts`。

## 2. 排序：「今日發文」

Sort option 文案 `最新發布` → `今日發文`（value 保持 `latest`）。

Comparator（兩鍵，日為主、秒為輔，dayCount 為最終 tiebreak）：

```ts
series.sort((a, b) => {
  const byDay = taipeiDay(lastPub(b)).localeCompare(taipeiDay(lastPub(a))); // 臺北日 desc
  if (byDay !== 0) return byDay;
  return latestPub(b) - latestPub(a); // 同日內按發文秒 desc
});
```

- 無文章系列：`taipeiDay` 對 `null` 回傳 `""` → 永遠排最後，與現況一致。
- 平手最終 tiebreak：維持現有 `dayCount` desc 排序（`applyFilter` 目前的 fallback）。

## 3. 動態狀態 chip（新 UI 元素）

卡片 head 新增小型 chip，**三態**（無異常不顯示）：

| 狀態 | 條件 | 樣式 | 文案 |
|---|---|---|---|
| 今日發文 | 最新文章臺北日 == 今天 | accent（沿用 accent-weak 底 + accent 字） | `今日發文` |
| 停更 N 天 | 最新文章臺北日 < 今天，且 N≥2 | warning（沿用 warning-weak 底 + warning 字） | `停更 N 天` |
| （無 chip） | 無文章 / 昨天發文（N=1）/ 完賽且非今日發文 | — | — |

- **N = 今天 − 最新文章臺北日**（天數差，`stalenessDays`）。
- **完賽系列（dayCount ≥ 30）**：已完成，停更不是異常 → 不顯示停更 chip；若完賽後今天仍有發文 → 顯示今日發文。
- **尚未開賽（無文章）**：不顯示任何 chip。
- 非臺北日格式的缺陷資料（parse 失敗）：不顯示 chip（`stalenessDays` 回傳 null）。

### 佈局

- **Grid card**：DAY badge 與 `.card-head-right`（瀏覽數 + RSS）之間，直接放在 `.card-head` 的 flex 流中（head 現在是 flex，左右兩端）。位置：DAY badge 右側。
- **List row**：DAY badge 之後、`row-title` 之前。
- 樣式：pill（`--radius-pill`）、`font-family: var(--font-sans)`、`font-size: var(--text-2xs)`、padding 2px 8px。沿用既有 token，不新增色彩。CSS 加在 `web/src/styles/design-system.css` 的 `.day-badge` 區塊旁（`.status-chip` / `.status-chip--stale`）。

## 4. SSR / client 一致性（修 handoff #2）

- 抽出唯一狀態運算來源：`web/src/lib/daily-status.ts`（`badgeClass`/`badgeText` 也搬進去？不搬 — badge 是展示邏輯，狀態**判定**（pending/done）在兩處重複；本次只新增 chip 判定，統一由 `daily-status.ts` 提供）。
- 具體修正：
  - `SeriesCard.astro`：`dayCount === 0` → badge 顯示 `尚未開賽`（修 `DAY ?`）。新增 chip 渲染（SSR build 時間的臺北日）。
  - `Dashboard.astro` client `renderCard` / `renderRow`：新增 chip 渲染（client render 時間的臺北日）。
- Astro static build 的 SSR 快照在跨日後會 stale，但 client JS 首次 render + 60s 週期會覆蓋成最新（與現有 `humanizeAll` 機制一致）。
- no-JS 使用者看到 build 當日的狀態，可接受（該日內正確）。

## 5. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `web/src/lib/daily-status.ts` | **新增**：`taipeiDay` / `taipeiToday` / `stalenessDays`（含 `lastPub` helper？不 — `latestPub` 已在 Dashboard 內，排序邏輯留在 Dashboard） |
| `web/src/lib/daily-status.test.ts` | **新增**：單元測試（fixture-based，不打網） |
| `web/src/components/Dashboard.astro` | sort 文案、comparator 改兩鍵、`renderCard`/`renderRow` 加 chip |
| `web/src/components/SeriesCard.astro` | SSR chip + badge 修正（`DAY ?` → `尚未開賽`） |
| `web/src/styles/design-system.css` | `.status-chip` 樣式（grid + list 共用） |

不改：`scripts/types.ts`、`scripts/scrape.ts`、`index.astro`、`data/`。

## 6. 測試策略

- `web/src/lib/daily-status.test.ts`：純函數測試（臺北日、天數差、邊界：跨日、N=1、N≥2、null、malformed、負差）。
- 驗證（改版後必跑，沿用 handoff 標準）：
  ```bash
  bun test                    # 既有 18 pass + 新增
  bunx tsc --noEmit           # 全專案型別乾淨
  cd web && bun run build     # Astro build 成功
  ```
- 手動 headless browser：載入 126+ 卡片、確認今日發文 chip（82 支）與停更 chip（前天發文那 1 支）、`今日發文` 排序把今日整組浮最上、60s refresh 後狀態更新、無 console error、無 XSS（client DOM 一律 `textContent`）。

## 7. 風險

- **跨日瞬間**：client 用 `Date.now()` 計算臺北今日，60s 週期自動校正；SSR 快照跨日 stale 由 client 覆蓋。
- **資料缺陷**：malformed `publishedAt` → chip 不顯示（安全降級），排序視為最舊。
- **語意變更**：`最新發布` → `今日發文` 改變排序結果 — 使用者已確認這是目標。
