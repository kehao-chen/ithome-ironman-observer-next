# 系列搜尋 — 手動回歸 Checklist

> 來源：`docs/superpowers/specs/2026-08-06-ironman-observer-search-design.md` §5.3（權威）。
> 用途：Dashboard.astro 互動行為的手動回歸清單（純函數層已有 `web/src/lib/search.test.ts` 自動測試；本清單覆蓋 UI 行為）。
> 建立：2026-08-06。最後執行：2026-08-06（功能開發時，headless Chromium，全 PASS）。

## 前置

```bash
cd web
bun install        # 首次
bun test           # 純函數單元測試（search + favorites + daily-status）
bunx tsc --noEmit  # 型別
bun run dev        # dev server（預設 http://localhost:4321）
```

用瀏覽器（或 headless browser）開啟 `http://localhost:4321`。

## Checklist

逐項驗證並勾選；任何 FAIL 修復後重跑該項，並在下方記錄。

- [ ] **1. 載入與即時過濾**：`#search` 出現在 toolbar（filter 與 sort 之間）；輸入即時縮小列表（無需按 Enter）。
- [ ] **2. 標題搜尋**：輸入標題關鍵字 → 只顯示命中系列；`shown-count` 反映過濾後筆數、分母維持年度總數。
- [ ] **3. 欄位命中**：輸入作者名 → 命中；輸入組別名 → 命中；輸入團隊名 → 命中（若有 team 資料）。
- [ ] **4. 多 token AND**：`vue 前端` → 兩個 token 都滿足才顯示。
- [ ] **5. 全形輸入**：輸入 `ＶＵＥ` → 命中半形資料（normalize 生效）。
- [ ] **6. 組別 × 搜尋組合**：切到特定組別再搜尋 → 交集；排序器（進度/最多觀看/今日發文）切換正常。
- [ ] **7. 收藏 × 搜尋組合**：收藏分頁內搜尋 → 子集交集；**有收藏但被搜尋全部排除 → 顯示搜尋空狀態**（非「尚未收藏任何系列」）；0 收藏時顯示「尚未收藏任何系列」（優先於搜尋空狀態）。
- [ ] **8. 無結果空狀態**：無結果 → 搜尋空狀態出現（帶 **raw query** 文案、`role="status"`）；清空 → 恢復完整列表、空狀態消失。
- [ ] **8b. 全空白 query**：只輸入空白 → 顯示完整列表（搜尋關閉），不顯示搜尋空狀態。
- [ ] **9. Escape 清空**：按 Escape → 清空 query 並保留焦點（焦點仍在 input）。
- [ ] **9b. RSS modal 優先**：RSS modal 開啟時按 Escape → **只**關閉 modal，搜尋 input 內容不變、不觸發重 render。
- [ ] **10. 年度切換**：切換年度 → query 保留、仍套用於新年度（註：目前資料只有 2026 一年，此項只能以 code inspection 驗證 `query` 為 module-level state、`loadYear→render→applyFilter` 會重讀）。
- [ ] **11. 無 console error**：操作全程無 console error；input focus 可見（鍵盤操作）。

## 執行紀錄

| 日期 | 環境 | 結果 | 備註 |
|---|---|---|---|
| 2026-08-06 | headless Chromium (1440×1000), dev server | 全 PASS | 功能開發時驗證；10 以 code inspection 驗證（單一年份） |

## 已知限制

- **10 年度切換**：目前 `data/meta.json` 只有 2026 一年，無法實機切換；query 保留邏輯以 code inspection 覆蓋（`query` 是 module-level mutable state，`loadYear()` → `render()` → `applyFilter()` 都會重讀）。日後新增年度時補實機驗證。
- **收藏依賴 localStorage**：第 7 項需先在卡片上點星號建立收藏；測試後可用 `localStorage.clear()` 重置。
