# Design: 系列搜尋（Search）

> Status: Approved 2026-08-06（brainstorming 流程）。
> Follows the competition-board design system（`design-system.css`）。
> Scope: PRODUCT.md roadmap mid-term「Search」（原 v1 non-goal，升級為候選）。

## Problem

使用者追蹤 ~127 支系列。現有組別篩選（group chips）＋排序（進度/最多觀看/今日發文）服務的是「依組別瀏覽」與「全域掃描」；當使用者想找**特定一支系列**（記得標題關鍵字、作者名，或只記得一半）時，只能逐卡掃描或按組別縮小再掃。127 筆已到肉眼掃描的極限。

## Goal

即時（type-as-you-type）系列搜尋：輸入即縮小列表，標題 / 作者 / 組別 / 團隊 任一欄位命中即列入候選，與既有組別分頁（含收藏分頁）、排序器自由組合。零後端、純 client-side、零 runtime 依賴（與「零成本架構」一致）。

## Non-Goals

- **不做模糊距離 / Levenshtein / 錯字容錯**（roadmap 討論已決議 deferred；127 筆短欄位，`normalize` + token AND 已覆蓋 99% 需求，錯字場景日後遇痛點再加）。
- 不做語意 / embedding / 相關性分數排序——分數會動搖現有排序器語意（量測儀器，不是搜尋引擎）。
- 不做 `Intl.Segmenter` / 斷詞 / Jieba——欄位是短字串 metadata（標題/作者/組別/團隊），非長文本全文；斷詞無價值。
- 不做 description（系列簡介）欄位比對——YAGNI，四欄位已覆蓋主要搜尋意圖。
- 不做關鍵字反白（highlight）——與現有 textContent-only 的 XSS 防線一致（反白需拆節點或 innerHTML）。
- 不做跨年度搜尋——搜尋作用於目前年度資料（與組別分頁、排序器同語意）。
- 不做簡繁映射——繁中不轉換（現有資料即繁中）；英文大小寫仍歸一。
- 不引入前端搜尋 library（Orama / Fuse.js / MiniSearch）——見 §5 決策記錄。

## 1. 搜尋語意

### 1.1 Token AND 比對

- query **先依空白切分**（`/\s+/`），**再逐 token `normalize`**——順序不可顛倒：`normalize` 會移除所有空白（§1.2 步驟 4），若先 normalize 整個 query，token 邊界會消失、AND 語意失效（例：`normalize("vue 前端")` → `"vue前端"`，退化成單一子字串）。
- 明確流程：

  ```ts
  const tokens = query.split(/\s+/).map(normalize).filter(Boolean);
  ```

  1. raw query 依空白切分（`\s+`，含多個連續空白與全形空格）。
  2. 每個 token 個別 `normalize`。
  3. `filter(Boolean)` 移除 normalize 後的空 token（如全形空白 token）。
  4. 每個 token 都要命中（AND 語意）；任一 token 命中任一欄位即算該 token 命中，**所有 token 皆命中才列入候選**。
  - 例：「vue 前端」→ 標題含 `vue` **且**（作者或組別或團隊含 `前端`）才算命中。
- 命中欄位（各欄位各自 `normalize` 後做**子字串**比對，比對雙方對稱）：
  - `title`（系列標題）
  - `user.name`（作者名）
  - `group`（組別）
  - `team`（團隊名，可為 `null`；`null` 不命中任何 query——比對前先處理）
- `tokens.length === 0`（空 query 或全空白）→ 搜尋關閉，全部候選（見 §1.3）。

### 1.2 `normalize(s): string`

依序套用：

1. NFC 正規化（`String.prototype.normalize("NFC")`）——組合字元統一，避免全形／半形與組字差異。
2. `toLowerCase()`——英文大小寫歸一。
3. **全形 → 半形**：全形字母、數字、空格、標點收斂成半形（`ＶＵＥ`→`vue`、`　`→` `）。僅收斂 ASCII 對應區段（U+FF01–U+FF5E → 對應 ASCII）；全形標點（如「，」）不在 ASCII 區段，維持原樣。
4. **移除所有空白**（`\s`，含一般空格、全形空格、tab）——token 內部無空格，token 邊界靠 query 的空白切分決定。

> 註：欄位資料（標題/作者/組別/團隊）與 query 都走同一 `normalize`，比對雙方對稱。

### 1.3 空 query

- `normalize(query)` 為空字串 → 搜尋關閉，回傳 `true`（全部候選）。

### 1.4 API

```ts
// web/src/lib/search.ts — 純函數、無 DOM、無 window、無 runtime 依賴。
import type { Series } from "../../../scripts/types"; // 與 Dashboard.astro 同路徑慣例

export function normalize(s: string): string;
export function seriesMatchesQuery(series: Series, query: string): boolean;
```

- `seriesMatchesQuery` 是純函數（無副作用），與 `daily-status.ts`／`favorites.ts` 同模式（可測、可注入、不打全域）。
- `Series` 型別**直接 import** 自 `scripts/types.ts`（跨目錄 import 是專案既有慣例：`Dashboard.astro` 即 `import type { YearData } from "../../../scripts/types"`）。**禁止**為避免跨目錄 import 而複製型別或改用 `any`——複製型別會造成後續漂移。

## 2. UI 與互動

### 2.1 輸入框（Toolbar）

- `.filter-group`（組別 chips）與 `.sort-wrap`（排序器）之間新增（**必須是 toolbar 的 sibling**，不可放入 `#group-filters`——年度切換時 `renderFilters()` 會重建 `#group-filters`，input 若在其中會被移除，違反 §2.2 query 保留需求）：

  ```html
  <div class="search-wrap">
    <input type="search" id="search" class="search-input" aria-label="搜尋系列（標題／作者／組別／團隊）" placeholder="搜尋系列…" autocomplete="off" spellcheck="false" />
  </div>
  ```

  - `type="search"`：原生自帶清除紐（webkit）；`autocomplete="off"`、`spellcheck="false"` 避免瀏覽器建議干擾。
  - 樣式：沿用 `sort-select` 的 border／radius／font 家族；`flex: 1 1 200px`、`min-width: 0`；focus-visible 描邊與 `sort-select` 一致。
  - **SSR 不輸出任何 value**（空）；無 JS 使用者看到完整清單（與現況一致）。

### 2.2 即時過濾

- `let query = ""`（Dashboard script 內的**模組級 mutable state**；`applyFilter(data, group, sort)` **不新增 query 參數**，函式內直接讀取目前 `query`——年度切換後保留、60s refresh 後重新套用，且現有所有 `applyFilter` call site 不需逐一傳遞）。
- `input` 事件 → `query = input.value` → 重跑 `applyFilter`（現有唯一渲染管線，見 §3.1）。
- **Escape 鍵（與 RSS modal 的全域 handler 定義優先序）**：
  - 現有 `document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRss(); })` 已存在；`#search` 的 Escape 會冒泡到 document。
  - **優先序**：
    1. RSS modal 開啟（`#rss-modal.open`）：Escape **只**關閉 modal，**不**清空搜尋。
    2. RSS modal 關閉：Escape 清空 input、`query = ""`、重跑 `applyFilter`、`input.focus()`（焦點保留）。
  - 實作：在 `#search` 的 `keydown` 先檢查 modal 狀態——開啟則不處理（讓事件冒泡到 document 關 modal）；關閉則 `preventDefault()`＋清空＋聚焦（`type="search"` 原生 Escape 行為亦被此取代，不重複觸發）。
- 年度切換：query 保留（與收藏分頁同語意——切換年度後仍套用搜尋）。

### 2.3 空狀態與計數

- 現有收藏空狀態（`fav-empty`：「尚未收藏任何系列」）保留。
- 新增搜尋空狀態，**判定基準與優先序**（見 §3.1 管線圖，兩者皆由 `applyFilter` 在 `#series-list` 內產生且**互斥**）：

  ```html
  <div class="search-empty" id="search-empty" role="status" aria-live="polite" tabindex="-1" hidden>
    <p>沒有符合「{query}」的系列</p>
    <p class="search-empty-hint">試試其他關鍵字，或調整組別／排序。</p>
  </div>
  ```

  - **判定基準（重要）**：收藏空狀態看**搜尋前**的收藏數（`currentYearFavCount(data) === 0`，即 `favSeries(data).length === 0`），**不是**搜尋後的 `series.length`——若用搜尋後長度判斷，有收藏但被搜尋全部排除時會誤顯示「尚未收藏任何系列」。
  - **優先序**：
    1. 收藏分頁且搜尋前收藏數為 0 → 顯示現有「尚未收藏任何系列」。
    2. 其餘且搜尋後 `series.length === 0` 且有搜尋 token → 顯示搜尋空狀態。
    3. 其餘 → 渲染卡片。
  - 搜尋空狀態文案：顯示**原始 `input.value`**（非 normalized query——使用者看到的與輸入一致），以 `textContent` 組裝（避免 XSS）。**僅空白的 query 視為搜尋關閉**（`tokens.length === 0`），不顯示搜尋空狀態。
  - 兩者皆 `role="status"`、`aria-live="polite"`、`tabindex="-1"`（可聚焦，清空後可還焦）。
- **狀態列**「已顯示 X / Y」：X = 過濾後筆數（不變），Y 維持現語意（年度總數或收藏數）——搜尋只是縮小目前視圖，分母不動。

## 3. Client 狀態與流程（Dashboard.astro script）

### 3.1 `applyFilter` 管線（唯一渲染入口）

現行管線：`data.series` →（組別/收藏分頁 filter）→（排序）→ 渲染。

新增一步：組別 filter **之後**、排序**之前**套用 `seriesMatchesQuery(series, query)`。排序器、組別分頁、收藏分頁、搜尋四者自由組合；排序器只作用於搜尋後的子集，排序語意完全不受影響。

**明確管線與空狀態分支**（`list.replaceChildren()` 之後）：

```ts
let series = data.series;
if (group === "fav") series = favSeries(data);      // 收藏分頁：目前年度已收藏子集
else if (group !== "全部") series = series.filter((s) => s.group === group);

series = series.filter((s) => seriesMatchesQuery(s, query)); // 搜尋（新步驟，排序前）

list.replaceChildren();
if (group === "fav" && currentYearFavCount(data) === 0) {
  renderFavEmpty();                                  // 收藏分頁且搜尋前收藏數為 0
} else if (series.length === 0 && hasSearchTokens(query)) {
  renderSearchEmpty();                               // 搜尋無命中（含收藏有但被搜尋排除）
} else {
  renderSeries(series);                              // 排序 + 渲染
}
```

- `currentYearFavCount(data) === 0` 等價於 `favSeries(data).length === 0`（搜尋前收藏數）——**不可**用搜尋後的 `series.length` 判斷收藏是否為空。
- `hasSearchTokens(query)`：`query.split(/\s+/).map(normalize).filter(Boolean).length > 0`（空 query／全空白 → 無 token → 不顯示搜尋空狀態，渲染卡片）。
- 兩個空狀態（`fav-empty`／`search-empty`）皆由 `applyFilter` 在 `#series-list` 內產生且互斥；各自重建（`replaceChildren()` 已移除 SSR 節點，必須重建）。
- `render(data)`：年度切換 / 60s refresh 時，query 保留（`applyFilter` 內讀取模組級 `query`）。
- `shownCount`／`totalCount`：沿用現語意（X = 過濾後、Y = 年度總數或收藏數），搜尋不新增分母變體。

### 3.2 事件

- `#search` 的 `input` → `query = value` → `applyFilter(current, group, sort)`。
- `#search` 的 `keydown`（Escape）→ 依 §2.2 優先序：modal 開啟則不處理（冒泡至 document 關 modal）；否則清空 value、`query = ""`、重跑 `applyFilter`、`input.focus()`（焦點保留）。
- 空狀態聚焦：清空搜尋後若原本聚焦在 `#search-empty`（搜尋空狀態），焦點還給 input（避免元素消失後焦點掉落）。

## 4. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `web/src/lib/search.ts` | **新增**：`normalize`／`seriesMatchesQuery` 純函數（單元測試對象，見 §5.1） |
| `web/src/lib/search.test.ts` | **新增**：單元測試（Bun test，模式同 `favorites.test.ts`） |
| `web/src/components/Dashboard.astro` | Toolbar 新增 `#search` input、`query` 狀態、`applyFilter` 管線加一步、搜尋空狀態區塊＋優先序判定、Escape 處理、空狀態焦點管理 |
| `web/src/styles/design-system.css` | `.search-wrap`／`.search-input` 樣式（沿用 `sort-select` 家族）、`.search-empty` 空狀態樣式 |
| `README.md` | **實作後同步更新**（與實作同一 commit）：Features 行加 search；Non-goals 行移除 search。本 spec commit 不含 README 變更。 |
| `docs/superpowers/specs/…search-design.md` | 本 spec |
| `PRODUCT.md` | roadmap mid-term「Search」標記完成（實作後） |

不改：`scripts/`（scraper 零變動）、`daily-status.ts`、`favorites.ts`、RSS modal、`data/` shape、`.github/workflows/`、`SeriesCard.astro`（搜尋不觸及卡片）。

## 5. 測試策略

### 5.1 單元（`web/src/lib/search.test.ts`，Bun test，模式同 `daily-status.test.ts`／`favorites.test.ts`）

- `normalize`：
  - 全形→半形（`ＶＵＥ` → `vue`、全形數字→半形、全形空格→半形）。
  - 大小寫歸一（`Vue` → `vue`）。
  - 空白收斂／移除（`  VUE  ` → `vue`；token 內部空白移除）。
  - 繁中原文保留（`前端` → `前端`，不轉換）。
- `seriesMatchesQuery`：
  - 空 query → `true`（搜尋關閉）。
  - 全空白 query（`"   "`、`"　"`）→ `true`（`filter(Boolean)` 後無 token → 搜尋關閉）。
  - token AND：「vue 前端」→ 標題含 `vue` 且作者含 `前端` 才命中；缺一不命中。
  - 四欄位各命中（標題／作者／組別／團隊各自獨立命中）。
  - `team: null` 安全（不 throw、不命中）。
  - 全形 query 命中半形資料（`ＶＵＥ` 命中 `vue`）——normalize 對稱性。
  - 全形空格分隔 token（`vue　前端`）→ AND 語意照常（split `\s+` 含全形空格）。
  - 多 token 全命中才列入（`a b`：標題含 a 但全欄位無 b → 不命中）。

### 5.2 Build / 型別

- `bunx tsc --noEmit` 乾淨；`bun test` 全綠（既有 + 新增）。
- `bun run build` 成功。

### 5.3 手動 headless browser

1. 載入：`#search` 出現（toolbar，filter 與 sort 之間）；輸入即時縮小列表（無需 Enter）。
2. 輸入標題關鍵字 → 只顯示命中系列；`shown-count` 反映過濾後筆數、分母維持年度總數。
3. 輸入作者名 → 命中；輸入組別名 → 命中；輸入團隊名 → 命中（若有 team 資料）。
4. 多 token AND：`vue 前端` → 兩條件都滿足才顯示。
5. 全形輸入 `ＶＵＥ` → 命中半形資料（normalize 生效）。
6. 組別分頁 + 搜尋組合：切到特定組別再搜尋 → 交集；排序器（進度/最多觀看/今日發文）切換正常。
7. 收藏分頁 + 搜尋組合：收藏分頁內搜尋 → 子集交集；**有收藏但被搜尋全部排除 → 顯示搜尋空狀態**（非「尚未收藏任何系列」）；0 收藏時顯示「尚未收藏任何系列」（優先於搜尋空狀態）。
8. 無結果 → 搜尋空狀態出現（帶 **raw query** 文案、`role="status"`）；清空 → 恢復完整列表、空狀態消失。
8b. 全空白 query → 顯示完整列表（搜尋關閉），不顯示搜尋空狀態。
9. Escape → 清空並保留焦點（焦點仍在 input）。
9b. RSS modal 開啟時按 Escape → **只**關閉 modal，搜尋 input 內容不變、不觸發重 render。
10. 年度切換：query 保留、仍套用於新年度。
11. 無 console error；input focus 可見（鍵盤操作）。

## 6. 風險

- **每 keystroke 全量掃描**：127 × 4 欄位 × normalize，每次 keyup 微秒級——無效能問題（索引化反而先付建構成本）。資料量破千再評估。
- **Escape 與焦點**：`type="search"` 的 Escape 原生行為（清空）與 keydown handler 重疊——handler 統一處理（清空 + 保留焦點），原生行為不重複觸發。RSS modal 開啟時的優先序見 §2.2（modal 優先，搜尋不清空）。
- **token 切分 vs normalize 順序**：先 split 後逐 token normalize（§1.1）——先 normalize 整個 query 會吃掉 token 邊界、退化成單一子字串，AND 語意失效。測試已覆蓋全形空格分隔（§5.1）。
- **全形 vs 半形資料**：iThome 標題可能混用全形標點；normalize 只收斂 ASCII 對應區段，全形中文標點（「，」）維持原樣——搜尋中文關鍵字不受影響。
- **空狀態優先序**：收藏分頁 0 收藏 vs 有 query 無命中——優先顯示「尚未收藏任何系列」（既有 UX，不因搜尋改變）。
- **不引入 library 的正當性**：見下。

## 7. 決策記錄（Library 評估）

探索過現成前端搜尋 library（對中文支援友善者）：

| | 中文支援 | 核心機制 | 為何不用 |
|---|---|---|---|
| **Orama** | 原生最好（`@orama/tokenizers` `mandarin`） | CJK 斷詞 tokenizer + stopwords | 差異化能力（斷詞/分數/索引）全是我們 Non-Goals；為 30 行問題背 3 個依賴 |
| **Fuse.js** | 無需設定（字元級 Bitap） | 模糊匹配 + 分數排序 | 分數排序已否決；只當 filter 等於背整套模糊引擎 |
| **MiniSearch** | 需手動（`Intl.Segmenter`／Jieba） | 空格語言索引 | 中文斷詞對短欄位無價值，且 `Intl.Segmenter` 有舊瀏覽器相容成本 |

決策：**自己寫 30 行純函數**（`normalize` + token AND）。理由：
1. 我們的資料是**短字串 metadata**（標題/作者/組別/團隊），不是長文本全文——斷詞、索引、分數的價值都為零。
2. 排序語意必須保持確定性（量測儀器），分數排序會動搖現有排序器。
3. 專案維持 client-side 零 runtime 依賴；`favorites.ts`／`daily-status.ts` 已是「純函數 + bun:test」模式，search 比照是慣例。
4. 日後若觸發（資料破千／搜尋內文／明確要錯字容錯），換 Orama 只需把 `seriesMatchesQuery` 內部換成 `db.search()`，呼叫端零改動。
