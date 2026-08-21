# 斷更落點單日分佈圖表設計

## 目標
將 Insights 分頁的「斷更觀察」圖表從單一序列階梯圖，改為「單日斷更落點分佈柱狀圖（Histogram）」，以清晰呈現斷更發生的天數分佈與斷崖高峰。

## 統計計算 (`web/src/lib/insights.ts`)
1. 沿用 `staleObservation(series, today)` 判定（`stalenessDays >= 2`、排除 `dayCount === 0` 與 `dayCount >= 30`）。
2. 新增 `staleDayDistribution(series: Series[], today: string)` 純函式：
   - 取得斷更系列列表。
   - 若無斷更系列，回傳空陣列 `[]`。
   - 若有斷更系列，統計最大斷更日 `maxDay = Math.max(...stale.map(s => s.dayCount))`（介於 1 到 29）。
   - 產生 `Day 1` 到 `Day maxDay`（或固定 1~29）的柱狀資料：`{ day: number; label: string; count: number }[]`。
   - 計算斷更高峰日（count 最大者）。
3. 摘要文案（SSR `Insights.astro` 與 client `insights.astro` 同步）：
   - 無資料：`所有系列目前都有更新`
   - 有資料：`${stale.length} 個系列已斷更 · 斷更高峰在 Day ${peak.day}（${peak.count} 系列）`

## 圖表呈現 (`web/src/pages/insights.astro`)
1. **圖表類型**：垂直柱狀圖（ECharts bar chart）。
2. **容器高度**：改為標準柱狀圖固定高度（移除 `stale.length * 28px` 的舊橫向高度計算）。
3. **X 軸**：`Day 1`, `Day 2`, ..., `Day maxDay`（Category），座標軸樣式與其他柱狀圖（如 `chart-daycount`）一致。
4. **Y 軸**：數值（Value），名稱 `斷更系列數`，純整數刻度。
5. **Series**：
   - `type: "bar"`
   - `itemStyle`: 警告/危險色系（`c.danger`），頂部圓角 `[2, 2, 0, 0]`。
   - `label`: 柱頂顯示數字（大於 0 顯示該值，0 則隱藏或不干擾視覺）。
6. **Tooltip**：
   - `Day N：X 個系列斷更（佔全部斷更的 Y%）`

## 驗證
1. 單元測試覆蓋 `staleDayDistribution`（空資料、單日斷更、跨日斷更、高峰計算、邊界排除）。
2. `bun test` 全數通過。
3. `bun run build` 成功，視覺驗證與 Astro SSG 產物檢查。
