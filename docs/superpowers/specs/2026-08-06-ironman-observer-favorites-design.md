# Design: 我的收藏（Favorites）

> Status: Approved 2026-08-06（brainstorming 流程）。
> Follows the competition-board design system（`design-system.css`）。
> Scope: PRODUCT.md roadmap mid-term「Favorites / tracking specific series」。

## Problem

使用者追蹤 ~127 支系列，但每次回訪只能靠組別篩選＋排序掃描全部卡片，找不到「我在乎的那幾支」的快速入口。現有排序（進度/最多觀看/今日發文）服務的是「全域掃描」，不是「個人追蹤」。

## Goal

localStorage 書籤（零後端、零成本，符合架構）＋「我的收藏」獨立分頁：只顯示已收藏系列，沿用現有排序器。收藏以**系列 ID 為 key、跨年度共用**（同一系列不同年度是同一支，年度切換不影響收藏）。

## Non-Goals

- 不做釘選到頂（使用者已選獨立分頁）。
- 不做收藏清單的拖曳排序/分組/註記——YAGNI，分頁內沿用現有排序器即可。
- 不做跨裝置同步（無後端，localStorage 為限；README 註明）。
- 不做 search（roadmap 另一候選，獨立功能）。

## 1. 資料模型

### 1.1 localStorage

- key：`ironman-observer:favorites`，值：`number[]`（系列 ID 陣列，順序=收藏順序，但 UI 不依賴順序）。
- 系列 ID 即 `YearData.series[].id`（`scripts/types.ts` 既有欄位），跨年度共用。
- **寫入策略**：每次 toggle 全量覆寫 `localStorage.setItem(key, JSON.stringify(ids))`。127 支上限、寫入頻率極低（使用者手動點擊），全量覆寫最單純且無併發問題。
- **讀取容錯**（`loadFavorites()`）：
  - key 不存在 / JSON.parse 失敗 / 值不是 array / 元素不是 number → 回傳 `[]`（不 throw、不嘗試修復寫回）。
  - 防禦下限：array 元素 filter 成 `typeof === "number"`（未來資料 shape 變動不致崩潰）。
- **localStorage 不可用**（隱私模式/Safari 舊版 `setItem` throw）：`saveFavorites()` try/catch，失敗靜默（星號仍可點、但刷新後不保留）；不影響其他功能。

## 2. UI

### 2.1 SeriesCard 星號按鈕

- 卡片 `card-head-right`、RSS 按鈕左側新增：

  ```html
  <button class="card-action card-fav" type="button" data-fav-id={s.id} aria-pressed="false" aria-label="收藏系列" title="收藏系列">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9z"/></svg>
  </button>
  ```

  - `aria-pressed` 反映收藏狀態（SSR 初始 false；client 首次 render 依 localStorage 覆蓋）。
  - 星形 path（stroke-only）——收藏時填 `currentColor`。
- **CSS**（`design-system.css`）：
  - `.card-fav` 與現有 `.card-action` 同尺寸；預設 outline 星形、`color: var(--text-muted)`。
  - `.card-fav[aria-pressed="true"]`：填色（`fill: currentColor`、`color: var(--accent)` 或既有警示色系）、hover 微亮。
  - 點擊動畫：`@keyframes fav-pop { 0%{transform:scale(1)} 40%{transform:scale(1.25)} 100%{transform:scale(1)} }`，點擊時加 class 觸發（`animation: fav-pop .25s ease`），`animationend` 移除。

### 2.2 Dashboard 收藏分頁

- 組別 filter 列（`#group-filters`）**最左**新增「我的收藏」按鈕：

  ```html
  <button data-group="fav" class="filter-btn" data-active="false">
    <span class="filter-label">我的收藏</span>
    <span class="filter-count tabular-nums" id="fav-count">0</span>
  </button>
  ```

  - 沿用現有 filter-btn 樣式（`data-active` 驅動 active 態），但加一個醒目標記（☆ 圖示或 accent 色）區分「組別」與「收藏」語意。
  - `#fav-count` 顯示目前年度中已收藏的系列數。
- **收藏分頁語意**：`data-group="fav"` 的 active 與其他組別互斥（點收藏分頁 → 其他組別 button 全部 `data-active="false"`，反之亦然）。
- **顯示邏輯**（`applyFilter` / `render` 共用）：active 為 `fav` 時，`data.series.filter(s => favSet.has(s.id))`；排序器照常套用（進度/最多觀看/今日發文皆適用於子集）。
- **空狀態**：收藏分頁 active 且收藏集合（對目前年度）為空時，`#series-list` 內顯示引導區塊：

  ```html
  <div class="fav-empty" id="fav-empty">
    <p>尚未收藏任何系列</p>
    <p class="fav-empty-hint">點卡片右上角星號開始追蹤你關心的系列。</p>
  </div>
  ```

  - 非收藏分頁時隱藏/移除（`hidden` 或重建）。
  - 收藏分頁時 `shown-count` 顯示 0 / 收藏數（空狀態下仍顯示「已顯示 0 / N」而非誤導為全部）。
- **取消收藏的即時行為**：若正在收藏分頁且該系列被取消收藏 → 卡片立即移出（`favSet` 更新後重 render 該子集）。在其他分頁取消收藏 → 卡片保留原位，僅星號變空。

### 2.3 Client 狀態與流程（Dashboard.astro script）

- 模組級 `let favSet = new Set<number>(loadFavorites())`。
- **toggle handler（事件委派）**：`#series-list` 容器 `click` 委派 `.card-fav`：
  1. `const id = Number(btn.dataset.favId)`；`favSet.has(id) ? favSet.delete(id) : favSet.add(id)`。
  2. `saveFavorites([...favSet])`。
  3. 更新該按鈕 `aria-pressed`/填色 class + 觸發動畫。
  4. `#fav-count` 重算（目前年度收藏數）。
  5. 若 active 是 `fav` 分頁 → 重 render 列表（子集變了）。
- **`render(data)` 整合**：現有 `render` 流程中，filter/sort 套用後若 active 是 `fav`，子集計算改用 `favSet`；`#fav-count` 每次 render 更新（年度切換後收藏數不同）。
- **60s refresh 與收藏分頁**：refresh 的 `render` 已包含 fav 子集重算（`favSet` 是模組級、直接引用），不需額外處理。
- **SSR 初始星號狀態**：SSR 一律 `aria-pressed="false"`；client script 於 `DOMContentLoaded` 前（module 頂層）遍歷 `.card-fav`，依 `favSet` 設定初始 `aria-pressed` 與 fill class，再進入首輪 render。因 SSR 已輸出星形 stroke，僅需補 `aria-pressed` 與 fill class，FOUC 範圍限於星號填色。
- **年度切換**：`loadYear` 後 `favSet` 不變（跨年度共用）；`#fav-count` 與空狀態依新年度資料重算。

### 2.4 年度切換後收藏 ID 不存在

- 收藏的系列 ID 在目前年度不存在（該系列今年未參賽）：分頁內自然被 `filter` 排除，不顯示死連結；`#fav-count` 只算存在者。無需額外處理。

## 3. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `web/src/components/SeriesCard.astro` | `card-head-right` 新增星號按鈕（`data-fav-id`、`aria-pressed`、star SVG） |
| `web/src/components/Dashboard.astro` | 「我的收藏」filter 按鈕 + `#fav-count`、`favSet`/`loadFavorites`/`saveFavorites`/toggle 委派、fav 子集 filter 邏輯、空狀態區塊、SSR 初始星號狀態同步 |
| `web/src/styles/design-system.css` | `.card-fav` 樣式＋`[aria-pressed="true"]` 填色、`fav-pop` 動畫、收藏 filter 按鈕醒目標記、`.fav-empty` 空狀態樣式 |
| `web/src/lib/favorites.ts` | 純函數：`loadFavorites(): Set<number>`、`saveFavorites(ids)`、`toggleFavorite(set, id)`（單元測試對象，見 §4） |
| `docs/superpowers/specs/…favorites-design.md` | 本 spec |
| `PRODUCT.md` | roadmap mid-term「Favorites」標記完成（實作後） |

不改：`scripts/`（scraper 零變動）、`daily-status.ts`、RSS modal、`data/` shape、`.github/workflows/`。

## 4. 測試策略

### 4.1 單元（`web/src/lib/favorites.test.ts`，Bun test，模式同 `daily-status.test.ts`）

- `toggleFavorite`：加/減/再加往返；對不存在的 id 移除是 no-op。
- `loadFavorites` 容錯：key 不存在、JSON 壞掉、非 array、array 內混入非 number → 全回傳 `[]`（或過濾後集合）。
- `saveFavorites`：round-trip（`save` 後 `load` 得原集合）。
- 純函數不打 localStorage：`loadFavorites`/`saveFavorites` 接受注入的 `Storage`-like 物件（測試用 stub），prod 傳 `window.localStorage`。

### 4.2 Build / 型別

- `bunx tsc --noEmit` 乾淨；`bun test` 全綠（既有 + 新增）。
- `bun run build` 成功。

### 4.3 手動 headless browser

1. 載入：星號按鈕出現、初始未填色；「我的收藏」tab 出現、count 0。
2. 點星號 → 填色＋動畫；`#fav-count` 變 1；localStorage 有 `ironman-observer:favorites`。
3. 切到「我的收藏」分頁 → 只顯示該系列；排序器（進度/最多觀看/今日發文）切換正常。
4. 空狀態：取消最後一個收藏 → 卡片移出、出現引導文案、`shown-count` 0。
5. 重新整理 → 收藏保留（localStorage 持久）；切換年度 → 收藏保留、count 依該年度重算。
6. 無 console error；星號按鈕 focus 可見（鍵盤操作）。

## 5. 風險

- **localStorage 不可用**（隱私模式）：`saveFavorites` try/catch 靜默失敗，星號仍可點但刷新不保留——可接受的降級，README 註明。
- **收藏分頁＋排序器**：`latest`（今日發文）排序套用於收藏子集，無收藏時空狀態顯示——語意一致。
- **SSR 星號初始狀態 FOUC**：SSR 一律未填色、client 首輪同步——星號是小型視覺元素，閃爍可接受；inline script 盡量前置。
- **`aria-pressed` 語意**：用 toggle button 而非 checkbox——星號是「釘選」動作，`aria-pressed` 是正確的 ARIA 語意（非表單送出）。
- **跨年度 ID 穩定性**：`series.id` 在 iThome 是系列頁 URL 的一部分（`/ironman/{id}`），年度間穩定；若未來 id 語意改變，收藏分頁自然排除不存在者（§2.4），不致破損。
