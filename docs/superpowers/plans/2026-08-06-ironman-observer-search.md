# 系列搜尋（Search）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在鐵人觀察家儀表板加即時（type-as-you-type）系列搜尋——標題 / 作者 / 組別 / 團隊任一欄位命中即列入，與組別分頁（含收藏分頁）、排序器自由組合；純 client-side、零 runtime 依賴。

**Architecture:** 純函數 `normalize` + token AND 子字串比對（不引 library）。`query` 是 Dashboard.astro script 內的模組級 mutable state；`applyFilter(data, group, sort)` 內直接讀取，組別 filter 之後、排序之前套用搜尋；空狀態分支（fav-empty / search-empty）在 `replaceChildren()` 後判定。

**Tech Stack:** Bun（test runner）、Astro 5（SSG + inline script）、TypeScript（型別共用以 `scripts/types.ts` 為權威）、原生 CSS（design-system.css）。

## Global Constraints

- **零 runtime 依賴**：client-side 不新增任何 library / dependency（spec §1.4、§7）。
- **XSS 防線**：client DOM 只用 `textContent` 組裝使用者資料，禁止 `innerHTML`（spec Non-Goals、PRODUCT.md「Client DOM uses `textContent` only」）。
- **繁中 only**：所有 UI 文案繁體中文（spec §2.3）。
- **排序語意不變**：搜尋只當 filter，不改排序器、不加相關性分數（spec Non-Goals）。
- **`Series` 型別直接 import**：`import type { Series } from "../../../scripts/types"`；禁止複製型別或改用 `any`（spec §1.4）。
- **query 判斷基準是 token 數**：`query.split(/\s+/).map(normalize).filter(Boolean)`，禁止 `normalize(query) === ""`（spec §1.3）。
- **收藏空狀態看搜尋前收藏數**：`currentYearFavCount(data) === 0`，禁止用搜尋後 `series.length`（spec §2.3、§3.1）。
- **SSR 不輸出 `#search` 的 value**（空）；無 JS 使用者看到完整清單（spec §2.1）。
- **空狀態動態建立時不得帶 `hidden`**（spec §2.3、§3.1）。
- 不修改：`scripts/`、`daily-status.ts`、`favorites.ts`、RSS modal、`data/` shape、`.github/workflows/`、`SeriesCard.astro`（spec §4）。

---

### Task 1: `normalize` 純函數（TDD）

**Files:**
- Create: `web/src/lib/search.ts`
- Test: `web/src/lib/search.test.ts`

**Interfaces:**
- Consumes: 無（`Series` 型別 import 延到 Task 2 引入——本 Task 只需 `normalize`）。
- Produces: `export function normalize(s: string): string` — 依序套用（spec §1.2）：① NFC 正規化 → ② `toLowerCase()` → ③ 全形→半形（U+FF01–U+FF5E 收斂到對應 ASCII；U+FF5E 全形波浪號 → `~`）→ ④ 移除所有空白（`/\s/g`，含全形空格）。

- [ ] **Step 1: 建立測試檔，寫 failing tests**

Create `web/src/lib/search.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { normalize } from "./search";

describe("normalize", () => {
  test("全形→半形（字母、數字、空格）", () => {
    expect(normalize("ＶＵＥ")).toBe("vue");
    expect(normalize("２０２６")).toBe("2026");
    expect(normalize("ｖｕｅ 前端")).toBe("vue前端");
  });
  test("大小寫歸一", () => {
    expect(normalize("Vue")).toBe("vue");
    expect(normalize("VUE")).toBe("vue");
  });
  test("前後空白與內部空白移除", () => {
    expect(normalize("  VUE  ")).toBe("vue");
    expect(normalize("V u e")).toBe("vue");
    expect(normalize("vue\t前端")).toBe("vue前端");
  });
  test("繁中原文保留（不轉換）", () => {
    expect(normalize("前端")).toBe("前端");
    expect(normalize("鐵人賽")).toBe("鐵人賽");
  });
  test("全形中文標點維持原樣（不在 ASCII 對應區段）", () => {
    expect(normalize("前端，你好")).toBe("前端，你好");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && bun test src/lib/search.test.ts`
Expected: FAIL — `Cannot find module './search'` 或 `normalize is not defined`。

- [ ] **Step 3: 寫 minimal implementation**

Create `web/src/lib/search.ts`:

```ts
// web/src/lib/search.ts — 純函數、無 DOM、無 window、無 runtime 依賴。

// 全形 ASCII 對應區段（U+FF01–U+FF5E）收斂成半形；U+FF5E（～）→ ~。
// 全形中文標點（如「，」）不在 ASCII 區段，維持原樣。
function fullToHalf(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

export function normalize(s: string): string {
  return fullToHalf(s.normalize("NFC").toLowerCase()).replace(/\s/g, "");
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web && bun test src/lib/search.test.ts`
Expected: PASS — 5 tests green。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/search.ts web/src/lib/search.test.ts
git commit -m "feat(search): add normalize pure function"
```

---

### Task 2: `seriesMatchesQuery` token AND 比對（TDD）

**Files:**
- Modify: `web/src/lib/search.ts`
- Test: `web/src/lib/search.test.ts`

**Interfaces:**
- Consumes: `normalize(s: string): string`（Task 1）；`Series` type 自 `../../../scripts/types`（relative 到 `web/src/lib/`，與 Dashboard.astro `import type { YearData } from "../../../scripts/types"` 同深度同慣例）。
- Produces: `export function seriesMatchesQuery(series: Series, query: string): boolean` — 先 split 再逐 token normalize（spec §1.1）；`tokens.length === 0` → `true`（搜尋關閉）；命中欄位：`title`、`user.name`、`group`、`team`（`team` 為 `null` 時不命中）；每 token 任一欄位命中即算命中，所有 token 命中才回 `true`。

- [ ] **Step 1: 擴充測試檔，寫 failing tests**

Append to `web/src/lib/search.test.ts` (在 import 行加入 `seriesMatchesQuery`；`Series` 型別用 `as Series` 斷言或 `satisfies Series` 造 fixture——fixture 只需測試用到的欄位，但以 `Series` 型別註記避免漏欄位)：

```ts
import { describe, expect, test } from "bun:test";
import { normalize, seriesMatchesQuery } from "./search";
import type { Series } from "../../../scripts/types";

function makeSeries(partial: Partial<Series>): Series {
  const base: Series = {
    id: 1,
    user: { id: 1, name: "小明", profileUrl: "https://ithelp.ithome.com.tw/users/1" },
    group: "Modern Web",
    title: "Vue 前端開發",
    description: "",
    team: null,
    signupDate: "2026-01-01",
    lastUpdated: null,
    dayCount: 7,
    articleCount: 7,
    subscriptions: 10,
    articles: [],
  };
  return { ...base, ...partial };
}

describe("seriesMatchesQuery", () => {
  const s = makeSeries({});

  test("空 query → true（搜尋關閉）", () => {
    expect(seriesMatchesQuery(s, "")).toBe(true);
  });
  test("全空白 query → true（filter(Boolean) 後無 token）", () => {
    expect(seriesMatchesQuery(s, "   ")).toBe(true);
    expect(seriesMatchesQuery(s, "　　")).toBe(true);
    expect(seriesMatchesQuery(s, " \t ")).toBe(true);
  });
  test("標題命中", () => {
    expect(seriesMatchesQuery(s, "vue")).toBe(true);
    expect(seriesMatchesQuery(s, "前端")).toBe(true);
  });
  test("作者名命中", () => {
    expect(seriesMatchesQuery(s, "小明")).toBe(true);
  });
  test("組別命中", () => {
    expect(seriesMatchesQuery(s, "modern")).toBe(true);
  });
  test("team 命中（team 非 null 時）", () => {
    expect(seriesMatchesQuery(makeSeries({ team: "DevOps 戰隊" }), "戰隊")).toBe(true);
  });
  test("team: null 安全——不 throw、不命中", () => {
    expect(seriesMatchesQuery(s, "戰隊")).toBe(false);
  });
  test("大小寫不敏感", () => {
    expect(seriesMatchesQuery(s, "VUE")).toBe(true);
  });
  test("全形 query 命中半形資料（normalize 對稱性）", () => {
    expect(seriesMatchesQuery(s, "ＶＵＥ")).toBe(true);
  });
  test("token AND：全部 token 命中才列入", () => {
    expect(seriesMatchesQuery(s, "vue 小明")).toBe(true); // 標題含 vue、作者含 小明
    expect(seriesMatchesQuery(s, "vue 不存在")).toBe(false);
    expect(seriesMatchesQuery(s, "vue 前端 小明")).toBe(true);
    expect(seriesMatchesQuery(s, "vue 前端 不存在")).toBe(false);
  });
  test("全形空格分隔 token 照常 AND", () => {
    expect(seriesMatchesQuery(s, "vue　小明")).toBe(true);
    expect(seriesMatchesQuery(s, "vue　不存在")).toBe(false);
  });
  test("無命中回 false", () => {
    expect(seriesMatchesQuery(s, "區塊鏈")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd web && bun test src/lib/search.test.ts`
Expected: FAIL — `seriesMatchesQuery is not defined`。

- [ ] **Step 3: 寫 implementation**

Append to `web/src/lib/search.ts`:

```ts
import type { Series } from "../../../scripts/types"; // 與 Dashboard.astro 同路徑慣例

// 每個 token 在任一欄位命中即算該 token 命中；所有 token 都命中才列入候選（AND）。
function tokenHits(series: Series, token: string): boolean {
  return (
    normalize(series.title).includes(token) ||
    normalize(series.user.name).includes(token) ||
    normalize(series.group).includes(token) ||
    (series.team !== null && normalize(series.team).includes(token))
  );
}

export function seriesMatchesQuery(series: Series, query: string): boolean {
  const tokens = query.split(/\s+/).map(normalize).filter(Boolean);
  if (tokens.length === 0) return true; // 空 query / 全空白 → 搜尋關閉
  return tokens.every((t) => tokenHits(series, t));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd web && bun test src/lib/search.test.ts`
Expected: PASS — normalize + seriesMatchesQuery 全綠。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/search.ts web/src/lib/search.test.ts
git commit -m "feat(search): add token-AND seriesMatchesQuery"
```

---

### Task 3: `design-system.css` 樣式

**Files:**
- Modify: `web/src/styles/design-system.css`（toolbar 區段，`.sort-select`/`.icon-btn` 家族之後、`.sort-wrap` 定義附近）

**Interfaces:**
- Consumes: 既有設計 token（`--space-*`、`--radius`、`--border`、`--surface`、`--text`、`--muted`、`--accent`、`--font-body`、`--text-sm`）——Task 4 的 HTML 引用 `.search-wrap`、`.search-input`、`.search-empty`。
- Produces: `.search-wrap`、`.search-input`、`.search-empty`（+ `.search-empty-hint`）樣式類。

- [ ] **Step 1: 寫樣式**

在 `web/src/styles/design-system.css` 的 `.sort-wrap { position: relative; flex-shrink: 0; }` 之後插入：

```css
/* ---------- Search input ---------- */
.search-wrap {
  flex: 1 1 200px;
  min-width: 0;
}
.search-input {
  appearance: none;
  width: 100%;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
  transition: border-color 0.12s ease;
}
.search-input::placeholder { color: var(--muted); }
.search-input:hover { border-color: var(--accent); }
.search-input:focus-visible { outline-offset: 1px; }

/* ---------- Search empty state ---------- */
.search-empty {
  grid-column: 1 / -1;
  padding: var(--space-8) var(--space-3);
  text-align: center;
  color: var(--muted);
}
.search-empty p { margin: 0; }
.search-empty-hint { margin-top: var(--space-2) !important; font-size: var(--text-sm); }
```

（`.search-empty` 的 `grid-column: 1 / -1` 讓空狀態在 grid 中佔滿整列；`grid` 模式與 `view-list` block 模式都正確顯示。**先執行** `grep "fav-empty" web/src/styles/design-system.css` 並 `read` 該區段——`.search-empty` 的 `padding`／`margin`／`color` 間距與 `.fav-empty` 對齊（既有空狀態的視覺節奏），不可憑空創造第二套間距。）

- [ ] **Step 2: 驗證樣式區段**

Run: `grep -n "search-wrap\|search-empty" web/src/styles/design-system.css`
Expected: 三組 selector（`.search-wrap`、`.search-input`、`.search-empty`）出現於 `.sort-wrap` 定義附近（toolbar 區段）。

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/design-system.css
git commit -m "style(search): add search input and empty-state styles"
```

> 註：本 Task 無單獨測試——樣式由 Task 6 的 headless browser checklist 驗證。Commit 時機：樣式單獨 commit 合理（可獨立 review），若與 Task 4 同批進行亦可合併。

---

### Task 4: Dashboard.astro 整合（toolbar input + query state + applyFilter 管線 + 空狀態 + Escape）

**Files:**
- Modify: `web/src/components/Dashboard.astro`（frontmatter import 區；toolbar HTML；script 的 state 宣告、`applyFilter`、事件區、RSS Escape handler）

**Interfaces:**
- Consumes: `seriesMatchesQuery`（Task 2）；既有 `favSeries`、`currentYearFavCount`、`renderFilters`、`applyFilter`、`closeRss`（已在 script 內，勿改名）。
- Produces: 模組級 `let query = ""`；`applyFilter` 三路空狀態分支；`#search` input/keydown 事件；RSS modal Escape 優先序。

- [ ] **Step 1: frontmatter 加 import**

在 `web/src/components/Dashboard.astro` frontmatter（`import type { YearData } from "../../../scripts/types";` 之後）：

```ts
import { normalize, seriesMatchesQuery } from "../lib/search";
```

（`Series` 型別由 `applyFilter` 內的 filter 箭頭參數使用——沿用現有 `import type { YearData } from "../../../scripts/types";` 的同一 import 語句擴充為 `import type { Series, YearData } from "../../../scripts/types";`。）

- [ ] **Step 2: toolbar 加 `#search` input（sibling，非 `#group-filters` 內）**

在 `.filter-group` 的 `</div>` 與 `<div class="sort-wrap">` 之間插入：

```html
<div class="search-wrap">
  <input type="search" id="search" class="search-input" aria-label="搜尋系列（標題／作者／組別／團隊）" placeholder="搜尋系列…" autocomplete="off" spellcheck="false" />
</div>
```

**位置檢查**：`#search` 必須是 `.toolbar` 的直接子元素，**不得**放在 `id="group-filters"` 內（`renderFilters()` 年度切換時會 `wrap.textContent = ""` 重建，會把 input 移除——spec §2.1）。

- [ ] **Step 3: script 宣告模組級 `query` state 與 `searchInput` 參考**

在 `let viewMode: "grid" | "list" = "grid";` 附近（`let today = taipeiToday();` 之後亦可）加：

```ts
let query = ""; // 搜尋 query（模組級 state；applyFilter 內直接讀取，年度切換保留）
const searchInput = document.getElementById("search") as HTMLInputElement; // 供 applyFilter 空狀態 raw query 與事件使用
```

- [ ] **Step 4: `applyFilter` 加搜尋步驟與三路空狀態分支**

現行 `applyFilter` 的排序後區段（`list.replaceChildren();` 起）：

```ts
    list.replaceChildren();
    if (group === "fav" && series.length === 0) {
      // 空狀態是每次 render 的 output：replaceChildren() 已移除 SSR 節點，必須重建。
      const empty = document.createElement("div");
      empty.className = "fav-empty";
      empty.id = "fav-empty";
      ...
      list.appendChild(empty);
    } else {
      const frag = document.createDocumentFragment();
      for (const s of series) frag.appendChild(viewMode === "list" ? renderRow(s) : renderCard(s));
      list.appendChild(frag);
    }
    shownCount.textContent = String(series.length);
    totalCount.textContent = String(group === "fav" ? currentYearFavCount(data) : data.series.length);
    humanizeAll();
```

改成：

```ts
    series = series.filter((s: Series) => seriesMatchesQuery(s, query)); // 搜尋：組別 filter 之後、排序之前（spec §3.1）
    list.replaceChildren();
    if (group === "fav" && currentYearFavCount(data) === 0) {
      // 收藏分頁且搜尋前收藏數為 0（不可用搜尋後的 series.length——有收藏但被搜尋排除時會誤顯示）
      const empty = document.createElement("div");
      empty.className = "fav-empty";
      empty.id = "fav-empty";
      empty.setAttribute("role", "status");
      empty.setAttribute("aria-live", "polite");
      empty.tabIndex = -1;
      const p1 = document.createElement("p");
      p1.textContent = "尚未收藏任何系列";
      const p2 = document.createElement("p");
      p2.className = "fav-empty-hint";
      p2.textContent = "點卡片右上角星號開始追蹤你關心的系列。";
      empty.append(p1, p2);
      list.appendChild(empty);
    } else if (series.length === 0 && query.split(/\s+/).map((t) => normalize(t)).filter(Boolean).length > 0) {
      // 搜尋無命中（含收藏有但被搜尋排除）；顯示中的空狀態不得帶 hidden（spec §2.3）
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.id = "search-empty";
      empty.setAttribute("role", "status");
      empty.setAttribute("aria-live", "polite");
      empty.tabIndex = -1;
      const p1 = document.createElement("p");
      p1.textContent = `沒有符合「${searchInput.value}」的系列`; // raw query（textContent 組裝，XSS 安全）
      const p2 = document.createElement("p");
      p2.className = "search-empty-hint";
      p2.textContent = "試試其他關鍵字，或調整組別／排序。";
      empty.append(p1, p2);
      list.appendChild(empty);
    } else {
      const frag = document.createDocumentFragment();
      for (const s of series) frag.appendChild(viewMode === "list" ? renderRow(s) : renderCard(s));
      list.appendChild(frag);
    }
    shownCount.textContent = String(series.length);
    totalCount.textContent = String(group === "fav" ? currentYearFavCount(data) : data.series.length);
    humanizeAll();
```

**注意**：搜尋 filter 那行要加在排序**之前**（在 `series = [...series].sort(...)` 之前）；`normalize` 需 import（`import { normalize, seriesMatchesQuery } from "../lib/search";`——若 Task 1/2 已完成，import 行已有兩者）。空狀態條件用的 `query.split(...)` 是內聯 `hasSearchTokens`（spec §3.1）——不需額外函數。`searchInput` 已在 Step 3 宣告（script 頂部），此處直接使用。

- [ ] **Step 5: 加 `#search` 事件（input + keydown Escape，含 RSS modal 優先序）**

在事件區（`document.getElementById("sort")?.addEventListener("change", ...)` 附近）加（`searchInput` 已在 Step 3 宣告，勿重複宣告）：

```ts
  /* Search */
  const rssModal = document.getElementById("rss-modal");
  searchInput?.addEventListener("input", () => {
    query = searchInput.value;
    if (current) {
      const group = document.querySelector(".filter-btn[data-active='true']")?.getAttribute("data-group") ?? "全部";
      const sort = (document.getElementById("sort") as HTMLSelectElement)?.value ?? "dayCount";
      applyFilter(current, group, sort);
    }
  });
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (rssModal?.classList.contains("open")) return; // modal 開啟：冒泡到 document 關 modal，不清空搜尋（spec §2.2）
    e.preventDefault(); // 取代 type="search" 原生 Escape 行為，避免雙重觸發
    searchInput.value = "";
    query = "";
    if (current) {
      const group = document.querySelector(".filter-btn[data-active='true']")?.getAttribute("data-group") ?? "全部";
      const sort = (document.getElementById("sort") as HTMLSelectElement)?.value ?? "dayCount";
      applyFilter(current, group, sort);
    }
    searchInput.focus(); // 焦點保留
  });
```

**優先序確認**：現有 `document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRss(); })` 保留不動；`#search` 的 keydown 冒泡時若 modal 已開，先 return（不清空）→ document handler 關 modal；modal 未開則 `preventDefault()` 後清空+聚焦（document handler 的 `closeRss()` 會跑但 modal 本就關閉，無副作用）。

**空狀態焦點**：Escape 清空後 `searchInput.focus()` 已把焦點留在 input；若使用者先前把焦點 tab 到 `#search-empty`（`tabindex="-1"` 可聚焦）再按 Escape，input 重新聚焦即把焦點從消失的節點拉回（spec §3.2）。

- [ ] **Step 6: 驗證型別與測試**

Run: `cd web && bun test src/lib/search.test.ts && bunx tsc --noEmit`
Expected: search.test.ts PASS；tsc 無錯誤（若 Task 3 尚未跑完，CSS 無關；Dashboard.astro 改動需 tsc 通過）。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/Dashboard.astro
git commit -m "feat(search): wire search input into dashboard pipeline"
```

---

### Task 5: 文件更新（README + PRODUCT.md）

**Files:**
- Modify: `README.md`（Features 行、Non-goals 行）
- Modify: `PRODUCT.md`（roadmap mid-term「Search」標記完成）

**Interfaces:**
- Consumes: 無（純文件）。

- [ ] **Step 1: README Features 行加 search**

`README.md` 的 Features 行：

```markdown
- Features: year switcher (meta `years` authority), group filter + favorites tab, sort (dayCount / views / latest), client-side 60s refresh, scrapeLog notice, responsive.
```

改成：

```markdown
- Features: year switcher (meta `years` authority), group filter + favorites tab, sort (dayCount / views / latest), search (title/author/group/team, token AND), client-side 60s refresh, scrapeLog notice, responsive.
```

- [ ] **Step 2: README Non-goals 行移除 search**

```markdown
- Non-goals (v1): search, completion/active badges, real-time updates (periodic batch only).
```

改成：

```markdown
- Non-goals (v1): completion/active badges, real-time updates (periodic batch only).
```

- [ ] **Step 3: PRODUCT.md roadmap 標記 Search 完成**

`PRODUCT.md` mid-term：

```markdown
- **Search**: full-text search of series by title/author/group.
```

改成：

```markdown
- [x] **Search**（完成 2026-08-06）：`web/src/lib/search.ts` 純函數（`normalize` + token AND）＋toolbar `#search` input 即時過濾；命中標題/作者/組別/團隊；與組別分頁（含收藏分頁）、排序器自由組合；搜尋空狀態 `role="status"`；Escape 清空（RSS modal 優先）；跨年度 query 保留。
```

- [ ] **Step 4: Commit**

```bash
git add README.md PRODUCT.md
git commit -m "docs: mark search done, update README features"
```

---

### Task 6: 驗證（全套測試 + build + headless browser checklist）

**Files:**
- 無新檔案；驗證既有全貌。

**Interfaces:**
- Consumes: Task 1–5 的產出（`search.ts`、`search.test.ts`、`Dashboard.astro` 整合、CSS、docs）。

- [ ] **Step 1: 全測試 + 型別 + build**

Run: `cd web && bun test`（全測試；`search.test.ts` + 既有 favorites/daily-status 全綠）
Run: `cd web && bunx tsc --noEmit`（無錯誤）
Run: `cd web && bun run build`（Astro build 成功）

Expected: 三項全過。

- [ ] **Step 2: 本機啟動 + headless browser checklist（spec §5.3）**

啟動 dev server（背景）並逐項驗證。使用 `browser` 工具（或既有 harness 慣例）開啟 `http://localhost:4321`（或 build 產物）：

1. `#search` 出現（toolbar，filter 與 sort 之間）；輸入即時縮小列表（無需 Enter）。
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

逐項記錄 PASS/FAIL。任何 FAIL 修復後重跑該項。

- [ ] **Step 3: 收尾 Commit（若有修復）**

若 Step 2 發現並修復 bug：

```bash
git add -A
git commit -m "fix(search): address headless verification findings"
```

若全綠無修復，此步略過（Task 1–5 已各自 commit）。

---

## Self-Review

### 1. Spec coverage

| Spec 需求 | Plan Task |
|---|---|
| §1.1 token AND 流程（split → normalize → filter） | Task 2 Step 3 |
| §1.2 normalize 四步驟 | Task 1 Step 3 |
| §1.3 tokens.length === 0 → 搜尋關閉 | Task 2 Step 3（`tokens.length === 0`）、Task 2 Step 1 測試（全空白） |
| §1.4 API + Series import 慣例 | Task 2 Step 3、Global Constraints |
| §2.1 toolbar sibling input（非 group-filters 內） | Task 4 Step 2（含位置檢查註） |
| §2.2 模組級 query + input 事件 + Escape 優先序 | Task 4 Step 3/5 |
| §2.3 空狀態優先序 + raw query + 無 hidden | Task 4 Step 4 |
| §3.1 applyFilter 管線（搜尋在組別後、排序前；三路分支；hasSearchTokens 內聯） | Task 4 Step 4 |
| §3.2 事件 + 焦點管理 | Task 4 Step 5 |
| §4 CSS 樣式 | Task 3 |
| §4 README/PRODUCT 更新 | Task 5 |
| §5.1 單元測試清單 | Task 1/2 Step 1 |
| §5.2 build/型別 | Task 6 Step 1 |
| §5.3 headless checklist | Task 6 Step 2 |

### 2. Placeholder scan

- 所有 code step 皆有完整程式碼；無「TBD」「handle edge cases」「類似 Task N」。
- Task 3 Step 1 含明確的 fav-empty 對齊指示（先 `grep` 再 `read` 該區段、沿用間距）——非佔位符。

### 3. Type consistency

- `normalize(s: string): string`：Task 1 定義、Task 2 消費、Task 4 Step 4 內聯 `hasSearchTokens` 使用——一致。
- `seriesMatchesQuery(series: Series, query: string): boolean`：Task 2 定義、Task 4 Step 4 消費——一致。
- `Series` import 路徑 `../../../scripts/types`：Task 2 Step 3 定義、Task 2 Step 1 測試 fixture 使用——一致。
- `query`（模組級 `let`）與 `searchInput`（`const`，script 頂部 Step 3 宣告）：Task 4 Step 3 宣告、Step 4/5 讀寫——一致；無重複宣告、無 `input` 別名。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-06-ironman-observer-search.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每 Task 派新 subagent、task 間 review、快速迭代

**2. Inline Execution** — 本 session 用 executing-plans 批次執行、checkpoint 審閱

**Which approach?**
