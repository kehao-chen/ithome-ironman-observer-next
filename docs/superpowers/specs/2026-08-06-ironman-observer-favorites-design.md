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

### 1.1 localStorage 與 `favorites.ts` API（Storage 注入 + 純函數 toggle）

- key：`ironman-observer:favorites`，值：`number[]`（系列 ID 陣列，順序=收藏順序，但 UI 不依賴順序）。
- 系列 ID 即 `YearData.series[].id`（`scripts/types.ts` 既有欄位），跨年度共用。
- **寫入策略**：每次 toggle 全量覆寫 `storage.setItem(key, JSON.stringify(ids))`。127 支上限、寫入頻率極低（使用者手動點擊），全量覆寫最單純且無併發問題。
- **API（`web/src/lib/favorites.ts`）**：

  ```ts
  export type StorageLike = Pick<Storage, "getItem" | "setItem">;

  export function loadFavorites(storage: StorageLike | null): Set<number>;
  export function saveFavorites(storage: StorageLike | null, ids: Iterable<number>): void;
  export function toggleFavorite(set: ReadonlySet<number>, id: number): Set<number>;
  ```

  - 用詞：`loadFavorites`/`saveFavorites` 是**可測試函式（依賴注入）**，非純函數（有讀/寫副作用）；只有 `toggleFavorite` 是純函數（回傳新 Set、不 mutation 傳入集合）。
  - **`storage: null` 語意**：視為「storage 不可用」——`loadFavorites` 回傳空集合、`saveFavorites` no-op（皆不 throw）。
  - **Production access wrapper**（呼叫端）：`window.localStorage` getter 本身在受限環境可能 throw（發生在參數求值階段，函式內 try/catch 捕捉不到）。呼叫端必須：

    ```ts
    function getStorage(): StorageLike | null {
      try { return window.localStorage; } catch { return null; }
    }
    ```

    模組級 `const storage = getStorage()` 之後傳入 `loadFavorites(storage)` / `saveFavorites(storage, favSet)`。
  - **`toggleFavorite` 純函數 + 非法 ID no-op**：`const next = new Set(set)` 後加/刪；對非正 safe integer（`!Number.isSafeInteger(id) || id <= 0`）回傳不變的集合副本（no-op）。呼叫端 `favSet = toggleFavorite(favSet, id)`。
- **讀取容錯（`loadFavorites`）**：
  - `storage === null`（getter throw）→ 回傳空集合，不 throw。
  - `getItem` throw（隱私模式/權限拒絕）→ 回傳空集合，不 throw。
  - key 不存在 → 空集合。
  - JSON 解析失敗 / 解析結果不是 array → 空集合（整體失敗），**不嘗試修復或覆寫寫回**。
  - array 內容逐項過濾（元素錯誤不拖垮整體）：只保留 `Number.isSafeInteger(id) && id > 0` 的項目（排除 `NaN`、`Infinity`、小數、負數、`null`、字串）；重複 ID 由 `Set` 自然去重。
  - 範例：`[1, "2", null, 3]` → `Set {1, 3}`。
- **寫入容錯（`saveFavorites`）**：`storage === null` → no-op；`setItem` throw → try/catch 靜默忽略（星號仍可點、但刷新後不保留）；不影響其他功能。
- **版本策略**：key 不帶版本。**明確禁止自動遷移**——不支援其他格式/版本；解析失敗即回傳空集合，絕不嘗試把使用者資料「修復」或覆寫成其他形狀。

## 2. UI

### 2.1 SeriesCard 星號按鈕（grid view 與 list view 共用）

- 卡片 `card-head-right`、RSS 按鈕左側新增（grid view）：

  ```html
  <button class="card-action card-fav" type="button" data-fav-id={s.id} aria-pressed="false" aria-label="收藏系列" title="收藏系列">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9z"/></svg>
  </button>
  ```

- **list view 同款按鈕**：Dashboard 的 `renderRow()`（list view 動態建立卡片）必須輸出**同一個 `.card-fav` 按鈕**，沿用 `data-fav-id`、`aria-pressed`、`aria-label`、title 與填色狀態。收藏是系列層級狀態，**不因 view mode 改變可操作性**——grid/list 兩者皆可收藏/取消收藏，狀態互通（同一個 `favSet`）。
  - 實作註記：`renderRow()` 現為 `createElement` + `textContent` 組裝；星號按鈕用 `createElement("button")` + `setAttribute` 建立（SVG 可為 innerHTML 靜態樣板——SVG path 是程式內常數，非使用者資料，安全）。
  - `renderCard()`（grid）若為 SSR 卡片復用，狀態由首輪同步覆蓋；若為動態重建，與 `renderRow()` 同款處理。
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
  - `#fav-count` 語意固定為：**目前年度資料中存在且已收藏的系列數**，不代表 localStorage 跨年度總數。例：localStorage 有 `[101, 202]`、目前年度只有 101 → count 顯示 1，收藏分頁只顯示 101。
- **收藏分頁語意**：`data-group="fav"` 的 active 與其他組別互斥（點收藏分頁 → 其他組別 button 全部 `data-active="false"`，反之亦然）。**年度切換重建 filter chips 時保留原 active**（含 fav），見 §2.3。
- **顯示邏輯**（`applyFilter` / `render` 共用）：active 為 `fav` 時，`data.series.filter(s => favSet.has(s.id))`；排序器照常套用（進度/最多觀看/今日發文皆適用於子集）。
- **空狀態**：收藏分頁 active 且收藏集合（對目前年度）為空時，`#series-list` 內顯示引導區塊：

  ```html
  <div class="fav-empty" id="fav-empty">
    <p>尚未收藏任何系列</p>
    <p class="fav-empty-hint">點卡片右上角星號開始追蹤你關心的系列。</p>
  </div>
  ```

  - 非收藏分頁時隱藏/移除（`hidden` 或重建）。
  - **`shown-count` / `total-count` 分母語意**（`applyFilter` 定義）：
    - 一般分頁（全部/組別）：`shown / data.series.length`（現狀不變，年度全部系列數）。
    - 收藏分頁：`shown / currentYearFavoriteCount`（目前年度可顯示的收藏數）。收藏分頁無可用收藏時顯示 **`0 / 0`**（不顯示「0 / 127 支系列」誤導為全年度）。
- **取消收藏的即時行為**：若正在收藏分頁且該系列被取消收藏 → 卡片立即移出（`favSet` 更新後重 render 該子集）。在其他分頁取消收藏 → 卡片保留原位，僅星號變空。
  - **pop 動畫與立即移出的競爭**：收藏分頁內取消收藏時，重 render 會移除按鈕，pop 動畫可能看不到。決策：**收藏分頁取消收藏允許直接移除、不保證該次 pop 可見**（收藏動作（加入）時 pop 一定可見；取消時列表即時反映更重要）。加入收藏的 pop 動畫不受影響（該卡片本來就在列表內）。

### 2.3 Client 狀態與流程（Dashboard.astro script）

- 模組級 `const storage = getStorage()`（try/catch 包 `window.localStorage`，失敗回傳 `null`）；`let favSet = new Set<number>(loadFavorites(storage))`。
- **toggle handler（事件委派）**：`#series-list` 容器 `click` 委派 `.card-fav`：
  1. `const id = Number(btn.dataset.favId)`；**`if (!Number.isSafeInteger(id) || id <= 0) return;`**（UI 層防禦；`toggleFavorite` 內亦 no-op，雙層守住邊界）。
  2. `favSet = toggleFavorite(favSet, id)`（純函數回傳新集合）。
  3. `saveFavorites(storage, favSet)`。
  4. 更新該按鈕 `aria-pressed`/填色 class + 觸發動畫。
  5. `#fav-count` 重算（目前年度收藏數）。
  6. 若 active 是 `fav` 分頁 → 重 render 列表（子集變了）。
- **`render(data)` 整合**：現有 `render` 流程中，filter/sort 套用後若 active 是 `fav`，子集計算改用 `favSet`；`#fav-count` 每次 render 更新（年度切換後收藏數不同）。
- **60s refresh 與收藏分頁**：refresh 的 `render` 已包含 fav 子集重算（`favSet` 是模組級、直接引用），不需額外處理。
- **SSR 初始星號狀態**：SSR 一律 `aria-pressed="false"`；client script 於 `DOMContentLoaded` 前（module 頂層）遍歷 `.card-fav`，依 `favSet` 設定初始 `aria-pressed` 與 fill class，再進入首輪 render。因 SSR 已輸出星形 stroke，僅需補 `aria-pressed` 與 fill class，FOUC 範圍限於星號填色。
- **年度切換**：`loadYear` 後 `favSet` 不變（跨年度共用）。**active filter 跨年度保留**：年度切換觸發 filter chips 重建時，先讀取目前 active（`data-group`），重建後以相同 active 重新套用——原本在「我的收藏」分頁，切換年度後仍停留在收藏分頁；原本在「全部」/某組別，切換後維持該組別。`#fav-count` 與空狀態依新年度資料重算（見 §2.4：不存在於新年度的收藏 ID 自然排除）。
  - 實作註記：現有 `render()` 的 `lastRenderedYear` 分支目前會重建 filter 並重設 active 為「全部」；改為重建時保留原 active（或重建前快照、重建後重新 activate + 重 render）。

### 2.4 年度切換後收藏 ID 不存在

- 收藏的系列 ID 在目前年度不存在（該系列今年未參賽）：分頁內自然被 `filter` 排除，不顯示死連結；`#fav-count` 只算存在者。無需額外處理。

## 3. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `web/src/components/SeriesCard.astro` | `card-head-right` 新增星號按鈕（`data-fav-id`、`aria-pressed`、star SVG） |
| `web/src/components/Dashboard.astro` | 「我的收藏」filter 按鈕 + `#fav-count`、`favSet`/`loadFavorites`/`saveFavorites`/toggle 委派、fav 子集 filter 邏輯、空狀態區塊、SSR 初始星號狀態同步 |
| `web/src/styles/design-system.css` | `.card-fav` 樣式＋`[aria-pressed="true"]` 填色、`fav-pop` 動畫、收藏 filter 按鈕醒目標記、`.fav-empty` 空狀態樣式 |
| `web/src/lib/favorites.ts` | 純函數：`loadFavorites`/`saveFavorites`（注入 Storage）/`toggleFavorite`（純函數回傳新 Set）（單元測試對象，見 §4） |
| `README.md` | **實作後同步更新**（與實作同一 commit）：Features 行加 favorites；Non-goals 行移除 `login/favorites/tracking`；註明收藏僅限本裝置/瀏覽器（localStorage）。本 spec commit 不含 README 變更。 |
| `docs/superpowers/specs/…favorites-design.md` | 本 spec |
| `PRODUCT.md` | roadmap mid-term「Favorites」標記完成（實作後） |

不改：`scripts/`（scraper 零變動）、`daily-status.ts`、RSS modal、`data/` shape、`.github/workflows/`。

## 4. 測試策略

### 4.1 單元（`web/src/lib/favorites.test.ts`，Bun test，模式同 `daily-status.test.ts`）

- `toggleFavorite`：加/減/再加往返；對不存在的 id 移除是 no-op；**不 mutation 原 Set**（傳入 `ReadonlySet`，回傳新集合，原集合不變）；**非法 id（`0`、負數、`NaN`、小數、`Infinity`）→ no-op**（回傳內容不變的副本）。
- `loadFavorites` 容錯（注入 stub Storage）：
  - `storage` 為 `null` → 空集合、不 throw。
  - `getItem` **throw** → 回傳空集合、不 throw。
  - key 不存在 → 空集合。
  - JSON 解析失敗（`"{{{"`、`"[NaN]"`、`"[Infinity]"`——JSON 不支援這些值，parse 即 throw）→ 空集合。
  - JSON 是合法值但不是 array（`"42"`、`"null"`、`"{}"`）→ 空集合。
  - array 內混入 `null` / 字串 / 小數 / 負數 → 逐項過濾（`[1, "2", null, 3]` → `Set {1, 3}`）；`Number.isSafeInteger` 為 runtime defensive check（NaN/Infinity 無法以合法 JSON 進入此路徑，由 parse throw 涵蓋）。
  - duplicate IDs → 去重（`[1, 1, 2]` → `Set {1, 2}`）。
  - 解析失敗**不覆寫** localStorage（stub 驗證 `setItem` 未被呼叫）。
- `saveFavorites`：round-trip（`save` 後 `load` 得原集合）；`storage` 為 `null` → no-op；**`setItem` throw → 不拋錯**（靜默）。
- 可測試函式不打全域 localStorage：`loadFavorites`/`saveFavorites` 接受注入的 `StorageLike | null` 物件（測試用 stub / `null`），prod 傳 `getStorage()` 的結果。

### 4.2 Build / 型別

- `bunx tsc --noEmit` 乾淨；`bun test` 全綠（既有 + 新增）。
- `bun run build` 成功。

### 4.3 手動 headless browser

1. 載入：星號按鈕出現（grid view）、初始未填色；「我的收藏」tab 出現、count 0。
2. 點星號 → 填色＋動畫；`#fav-count` 變 1；localStorage 有 `ironman-observer:favorites`。
3. 切到「我的收藏」分頁 → 只顯示該系列；排序器（進度/最多觀看/今日發文）切換正常。
4. 空狀態：取消最後一個收藏 → 卡片移出、出現引導文案、`shown-count` 顯示 `0 / 0`。
5. 重新整理 → 收藏保留（localStorage 持久）。
6. **年度切換**：切換年度 → 收藏保留、仍停留在「我的收藏」分頁（active filter 不重設為全部）、`#fav-count` 依新年度重算（新年度無對應系列 → 空狀態、count 0）。
7. **list view**：切到 list view → 每列有同款 `.card-fav` 按鈕、收藏狀態與 grid 一致、可取消收藏；切回 grid view → 狀態同步。
8. **分母語意**：一般分頁顯示 `shown / 年度總數`；收藏分頁顯示 `shown / 目前年度收藏數`；收藏分頁 0 收藏顯示 `0 / 0`。
9. 無 console error；星號按鈕 focus 可見（鍵盤操作）。

## 5. 風險

- **localStorage 不可用**（隱私模式）：`window.localStorage` getter / `getItem` / `setItem` 任一步 throw 皆降級——`getStorage()` 回傳 `null`、`loadFavorites(null)` 回傳空集合、`saveFavorites(null, …)` no-op；星號仍可點但刷新不保留。可接受的降級，README 註明收藏僅限本裝置/瀏覽器。
- **收藏分頁＋排序器**：`latest`（今日發文）排序套用於收藏子集，無收藏時空狀態顯示（`0 / 0`）——語意一致。
- **SSR 星號初始狀態 FOUC**：SSR 一律未填色、client 首輪同步——星號是小型視覺元素，閃爍可接受；inline script 盡量前置。
- **`aria-pressed` 語意**：用 toggle button 而非 checkbox——星號是「釘選」動作，`aria-pressed` 是正確的 ARIA 語意（非表單送出）。
- **跨年度 ID 穩定性**：`series.id` 在 iThome 是系列頁 URL 的一部分（`/ironman/{id}`），年度間穩定；若未來 id 語意改變，收藏分頁自然排除不存在者（§2.4），不致破損。
