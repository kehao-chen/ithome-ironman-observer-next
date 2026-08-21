# 斷更觀察設計

## 目標
將 Insights 分頁的「完賽風險」改成客觀呈現已發生斷更的系列，顯示斷更發生在第幾個參賽日。

## 判定
沿用 `web/src/lib/daily-status.ts` 的 `stalenessDays`：最新文章距臺北今日至少 2 天（`stalenessDays >= 2`）即列入斷更觀察。`dayCount === 0` 的尚未開賽系列與 `dayCount >= 30` 的完賽系列排除。

## 呈現
- 區塊標題：`斷更觀察`
- 摘要：列出斷更系列數；無資料時顯示 `所有系列目前都有更新`。
- 每筆主資訊：`Day N 後斷更`，N 為 `dayCount`。
- 輔助資訊：tooltip 顯示已停更天數。
- 依 `dayCount` 由小到大排序；同值依停更天數由大到小排序。
- 圖表 X 軸改為最後完成日，移除 expected/deficit 與「落後天數」語意。

## 資料介面
將 `behindSchedule` 改為 `staleObservation(series, today)`，回傳 `StaleObservationRow[]`，每列包含 `title`、`author`、`group`、`dayCount`、`staleDays`。以最新文章的臺北日期判定停更，無法判定日期的系列排除。

## 驗證
更新純函式測試，涵蓋 2 天門檻、未開賽/完賽排除、排序與停更天數；執行相關 Bun 測試與 web build。
