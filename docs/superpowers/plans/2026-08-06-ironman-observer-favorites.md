# 我的收藏（Favorites）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** localStorage 書籤（系列 ID 跨年度共用）＋「我的收藏」獨立分頁：只顯示已收藏系列、沿用現有排序器，卡片星號 toggle（grid/list 皆可操作）。

**Architecture:** `web/src/lib/favorites.ts` 提供可測試函式（`loadFavorites`/`saveFavorites` 注入 `StorageLike | null`、`toggleFavorite` 純函數）→ SeriesCard SSR 星號 + Dashboard client `favSet` 狀態 → 收藏分頁 filter（`data-group="fav"`）→ CSS 樣式。零後端、零 scraper 變動。

**Tech Stack:** Astro 5 static + native CSS（`web/`）、TypeScript（`bun:test`）、localStorage。

## Global Constraints

- **Zero-cost 契約**：無後端、無 DB；收藏僅存 localStorage（僅限本裝置/瀏覽器）。
- **Scraper 零變動**：`scripts/`、`daily-status.ts`、RSS modal、`data/` shape、`.github/workflows/` 皆不改。
- **DOM 安全**：使用者/爬蟲資料一律 `textContent`；唯一允許 `innerHTML` 的是程式內常數 SVG 樣板（無使用者資料）。
- **localStorage 降級**：`window.localStorage` getter / `getItem` / `setItem` 任一步 throw → `getStorage()` 回傳 `null` → `loadFavorites(null)` 空集合、`saveFavorites(null, …)` no-op。**getter throw 必須由 wrapper 捕捉（函式內 try/catch 捕捉不到參數求值階段）。**
- **ID 有效性**：只有 `Number.isSafeInteger(id) && id > 0` 是合法收藏 ID；`toggleFavorite` 對非法 id no-op、UI handler 也防禦（雙層）。`saveFavorites` 預期接收由 `toggleFavorite`/`loadFavorites` 產生的合法 ID 集合，**不負責重新驗證資料**。
- **版本策略**：key 不帶版本；解析失敗回傳空集合，**禁止自動遷移/覆寫**。
- **`fav-count` 語意**：目前年度資料中存在且已收藏的系列數（非跨年度總數）。
- **分母語意**：一般分頁 `shown / data.series.length`；收藏分頁 `shown / 目前年度收藏數`；無收藏 `0 / 0`。
- **年度切換**：active filter 跨年度保留；**普通組別在新年度不存在時 fallback 到「全部」（fav 恆保留）**；收藏 ID 在新年度不存在者自然排除。
- **空狀態是 render state**：`#fav-empty` 由 `applyFilter` 每次重建（`list.replaceChildren()` 會移除 SSR 節點，不能依賴 SSR 初始節點）。
- **驗證門檻**：`bun test` 全綠、`cd web && bunx astro check` 乾淨、`bunx tsc --noEmit` 乾淨、`cd web && bun run build` 成功。

---

### Task 1: favorites.ts 可測試函式 + 單元測試（TDD）

**Files:**
- Create: `web/src/lib/favorites.ts`
- Test: `web/src/lib/favorites.test.ts`

**Interfaces:**
- Produces（後續 Task 全部依賴）：
  - `export type StorageLike = Pick<Storage, "getItem" | "setItem">;`
  - `export function loadFavorites(storage: StorageLike | null): Set<number>;`
  - `export function saveFavorites(storage: StorageLike | null, ids: Iterable<number>): void;`
  - `export function toggleFavorite(set: ReadonlySet<number>, id: number): Set<number>;`
  - `export function isValidFavoriteId(id: number): boolean;`

- [ ] **Step 1: 寫失敗測試**

Create `web/src/lib/favorites.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { loadFavorites, saveFavorites, toggleFavorite, type StorageLike } from "./favorites";

// In-memory StorageLike stub.
function makeStub(init?: string | null): { storage: StorageLike; get: () => string | null } {
  let value: string | null = init ?? null;
  return {
    storage: {
      getItem: () => value,
      setItem: (_k: string, v: string) => { value = v; },
    },
    get: () => value,
  };
}

const throwingStub = (method: "getItem" | "setItem"): StorageLike => ({
  getItem: method === "getItem" ? () => { throw new Error("denied"); } : () => null,
  setItem: method === "setItem" ? () => { throw new Error("quota"); } : () => {},
});

describe("toggleFavorite", () => {
  test("加 / 減 / 再加往返", () => {
    let s = new Set<number>();
    s = toggleFavorite(s, 101);
    expect([...s]).toEqual([101]);
    s = toggleFavorite(s, 101);
    expect(s.size).toBe(0);
    s = toggleFavorite(s, 101);
    expect([...s]).toEqual([101]);
  });
  test("移除不存在的 id 是 no-op", () => {
    const s = new Set([101]);
    expect([...toggleFavorite(s, 999)]).toEqual([101]);
  });
  test("不 mutation 原 Set（純函數）", () => {
    const s = new Set([101]);
    toggleFavorite(s, 202);
    expect([...s]).toEqual([101]);
    const out = toggleFavorite(s, 202);
    expect(out).not.toBe(s);
    expect([...out]).toEqual([101, 202]);
  });
  test("非法 id（0/負數/NaN/小數/Infinity）no-op", () => {
    for (const bad of [0, -5, NaN, 1.5, Infinity]) {
      const s = new Set([101]);
      const out = toggleFavorite(s, bad);
      expect([...out]).toEqual([101]);
      expect(out).not.toBe(s);
    }
  });
});

describe("loadFavorites", () => {
  test("storage 為 null → 空集合、不 throw", () => {
    expect(loadFavorites(null).size).toBe(0);
  });
  test("getItem throw → 空集合、不 throw", () => {
    expect(loadFavorites(throwingStub("getItem")).size).toBe(0);
  });
  test("key 不存在 → 空集合", () => {
    expect(loadFavorites(makeStub(null).storage).size).toBe(0);
  });
  test("JSON 解析失敗（malformed / NaN / Infinity）→ 空集合", () => {
    for (const raw of ["{{{", "[NaN]", "[Infinity]"]) {
      expect(loadFavorites(makeStub(raw).storage).size).toBe(0);
    }
  });
  test("合法 JSON 但不是 array → 空集合", () => {
    for (const raw of ["42", "null", "{}", '"str"']) {
      expect(loadFavorites(makeStub(raw).storage).size).toBe(0);
    }
  });
  test("array 內混入 null/字串/小數/負數 → 逐項過濾", () => {
    const s = loadFavorites(makeStub('[1, "2", null, 3, 4.5, -6]').storage);
    expect([...s].sort()).toEqual([1, 3]);
  });
  test("duplicate IDs 去重", () => {
    const s = loadFavorites(makeStub("[1, 1, 2, 2, 1]").storage);
    expect([...s].sort()).toEqual([1, 2]);
  });
  test("解析失敗不覆寫 localStorage（setItem 未被呼叫）", () => {
    let setCalls = 0;
    const storage: StorageLike = { getItem: () => "{{{", setItem: () => { setCalls++; } };
    loadFavorites(storage);
    expect(setCalls).toBe(0);
  });
});

describe("saveFavorites", () => {
  test("round-trip：save 後 load 得原集合", () => {
    const { storage, get } = makeStub();
    saveFavorites(storage, new Set([101, 202]));
    expect(JSON.parse(get()!)).toEqual([101, 202]);
    expect([...loadFavorites(storage)].sort()).toEqual([101, 202]);
  });
  test("storage 為 null → no-op、不 throw", () => {
    expect(() => saveFavorites(null, new Set([101]))).not.toThrow();
  });
  test("setItem throw → 不拋錯（靜默）", () => {
    expect(() => saveFavorites(throwingStub("setItem"), new Set([101]))).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test web/src/lib/favorites.test.ts`
Expected: FAIL — `Cannot find module "./favorites"`。

- [ ] **Step 3: 實作 favorites.ts**

Create `web/src/lib/favorites.ts`：

```ts
// Favorites: localStorage 收藏（系列 ID 跨年度共用）。
// 可測試函式：storage 以參數注入（StorageLike | null），不直接碰 window.localStorage；
// toggleFavorite 是純函數（回傳新 Set，不 mutation 傳入集合）。

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const KEY = "ironman-observer:favorites";

// 合法收藏 ID：正的 safe integer（排除 NaN / Infinity / 小數 / 負數 / 0 / 非數字）。
export function isValidFavoriteId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

// storage 不可用（null）或 getItem throw → 空集合；JSON 非 array → 空集合（不修復/覆寫）；
// array 內逐項過濾（元素錯誤不拖垮整體）；重複 ID 由 Set 自然去重。
export function loadFavorites(storage: StorageLike | null): Set<number> {
  if (!storage) return new Set();
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return new Set();
  }
  if (raw === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const ids = new Set<number>();
  for (const item of parsed) {
    if (typeof item === "number" && isValidFavoriteId(item)) ids.add(item);
  }
  return ids;
}

// storage 不可用（null）或 setItem throw → 靜默 no-op。
// 預期接收由 toggleFavorite／loadFavorites 產生的合法 ID 集合；不負責重新驗證資料。
export function saveFavorites(storage: StorageLike | null, ids: Iterable<number>): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // 靜默降級：星號仍可點，但刷新後不保留。
  }
}

// 純函數：回傳新 Set；非法 id（非正 safe integer）no-op（回傳內容不變的副本）。
export function toggleFavorite(set: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(set);
  if (!isValidFavoriteId(id)) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun test web/src/lib/favorites.test.ts`
Expected: PASS（全部案例）。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/favorites.ts web/src/lib/favorites.test.ts
git commit -m "feat(web): favorites core lib with tests"
```

---

### Task 2: SeriesCard SSR 星號按鈕（grid）

**Files:**
- Modify: `web/src/components/SeriesCard.astro`

**Interfaces:**
- Consumes: `series: Series`（既有 Props）。
- Produces: SSR 星號按鈕（`data-fav-id`、`aria-pressed="false"`）——Dashboard client 首輪同步覆蓋狀態。

- [ ] **Step 1: 加星號按鈕**

`web/src/components/SeriesCard.astro` 的 `card-head-right`（RSS 按鈕左側）加：

```astro
    <div class="card-head-right">
      <button class="card-action card-fav" type="button" data-fav-id={s.id} aria-pressed="false" aria-label="收藏系列" title="收藏系列">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9z"/></svg>
      </button>
      <button class="card-action" type="button" data-rss={rssUrl} data-title={s.title} aria-label="RSS 訂閱" title="RSS 訂閱">
```

- [ ] **Step 2: Build 驗證 SSR 輸出**

Run: `cd web && bun run build`
Expected: build 成功；產出 HTML 含 `<button class="card-action card-fav" ... data-fav-id="..." aria-pressed="false">`。

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SeriesCard.astro
git commit -m "feat(web): star toggle button in SeriesCard SSR"
```

---

### Task 3: Dashboard — 收藏分頁 + fav 狀態 + 星號 toggle（含 list view）

**Files:**
- Modify: `web/src/components/Dashboard.astro`

**Interfaces:**
- Consumes: `favorites.ts`（Task 1）的 `loadFavorites`/`saveFavorites`/`toggleFavorite`/`isValidFavoriteId`。
- Produces（CSS Task 4 依賴）：
  - SSR filter 按鈕：`<button data-group="fav" class="filter-btn" data-active="false"><span class="filter-label">我的收藏</span><span class="filter-count tabular-nums" id="fav-count">0</span></button>`（`#group-filters` 最左，`{groups.map(...)}` 之前）。
  - 空狀態容器：`<div class="fav-empty" id="fav-empty" hidden>…</div>`（`#series-list` 內、`{data.series.map(...)}` 之後、SSR 恆輸出、`hidden`）——**注意：client 首次 render 的 `list.replaceChildren()` 會移除它；空狀態是 `applyFilter` 的 render output（Task 3 Step 7 每次重建），SSR 節點只是 no-JS 兜底，不可依賴**。
  - 動態按鈕：`.card-fav`（grid `renderCard` 與 list `renderRow` 皆輸出，SVG 用常數 `FAV_ICON`）。

- [ ] **Step 1: SSR markup — 收藏分頁按鈕 + 空狀態容器**

`web/src/components/Dashboard.astro`：

1. `#group-filters` 內、`{groups.map((g) => (…))}` **之前**加：

```astro
      <button data-group="fav" class="filter-btn" data-active="false">
        <span class="filter-label">我的收藏</span>
        <span class="filter-count tabular-nums" id="fav-count">0</span>
      </button>
```

2. `#series-list` 內、`{data.series.map((s) => <SeriesCard series={s} />)}` **之後**加（保留既有 map）：

```astro
    <div class="fav-empty" id="fav-empty" hidden>
      <p>尚未收藏任何系列</p>
      <p class="fav-empty-hint">點卡片右上角星號開始追蹤你關心的系列。</p>
    </div>
```

- [ ] **Step 2: 加 import + storage wrapper + 模組級狀態**

Dashboard `<script>` 頂部（`import { isDeletedSeries, ... } from "../lib/daily-status";` 之後）加：

```ts
  import { loadFavorites, saveFavorites, toggleFavorite, isValidFavoriteId } from "../lib/favorites";
  // window.localStorage getter 本身可能 throw（受限環境）；wrapper 統一降級為 null。
  function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
    try { return window.localStorage; } catch { return null; }
  }
  const storage = getStorage();
  let favSet = new Set<number>(loadFavorites(storage));
```

- [ ] **Step 3: 加 FAV_ICON 常數**

`const RSS_ICON = svgEl(...)` 附近加：

```ts
  const FAV_ICON = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9z" }),
  ]);
```

- [ ] **Step 4: 加 fav 狀態 helper（renderFilters 前）**

```ts
  function currentGroup(): string {
    return document.querySelector(".filter-btn[data-active='true']")?.getAttribute("data-group") ?? "全部";
  }
  function isFavView(): boolean { return currentGroup() === "fav"; }
  // 目前年度資料中已收藏且存在的系列（收藏分頁的資料子集）。
  function favSeries(data: any): any[] { return data.series.filter((s: any) => favSet.has(s.id)); }
  // 收藏分頁的 shown/total 分母：目前年度可顯示收藏數。
  function currentYearFavCount(data: any): number { return favSeries(data).length; }
  // 年度切換時 resolve active：fav 恆保留；普通組別在新年度不存在 → fallback「全部」。
  function activeGroupFor(groups: string[], requested: string): string {
    if (requested === "fav") return "fav";
    return groups.includes(requested) ? requested : "全部";
  }
```

- [ ] **Step 5: renderFilters 加「我的收藏」按鈕 + 保留 active**

`renderFilters` 內 `for (const g of groups)` 之前加：

```ts
    const favBtn = document.createElement("button");
    favBtn.className = "filter-btn";
    favBtn.dataset.group = "fav";
    favBtn.dataset.active = String(activeGroup === "fav");
    const favLabel = document.createElement("span");
    favLabel.className = "filter-label";
    favLabel.textContent = "我的收藏";
    const favCnt = document.createElement("span");
    favCnt.className = "filter-count tabular-nums";
    favCnt.id = "fav-count";
    favCnt.textContent = "0";
    favBtn.append(favLabel, favCnt);
    wrap.appendChild(favBtn);
```

- [ ] **Step 6: render() 年度切換保留 active（含 fallback）+ 更新 fav-count**

`render()` 內 `if (lastRenderedYear !== data.year)` 區塊替換為：

```ts
    if (lastRenderedYear !== data.year) {
      lastRenderedYear = data.year;
      const groups = ["全部", ...data.groups];
      // 年度切換保留目前 active；普通組別在新年度不存在 → fallback「全部」（fav 恆保留）。
      const active = activeGroupFor(groups, currentGroup());
      renderFilters(groups, groupCounts(data), active);
    }
    const favCount = document.getElementById("fav-count");
    if (favCount) favCount.textContent = String(currentYearFavCount(data));
```

- [ ] **Step 7: applyFilter 支援 fav 子集 + 分母語意 + 空狀態 render output**

`applyFilter` 內 `let series = data.series; if (group !== "全部") ...` 改為：

```ts
    let series: any[] = data.series;
    if (group === "fav") {
      series = favSeries(data); // 收藏分頁：目前年度已收藏子集
    } else if (group !== "全部") {
      series = series.filter((s: any) => s.group === group);
    }
```

`applyFilter` 結尾（`const frag = document.createDocumentFragment();` 那段）整段替換為：

```ts
    list.replaceChildren();
    if (group === "fav" && series.length === 0) {
      // 空狀態是每次 render 的 output：replaceChildren() 已移除 SSR 節點，必須重建。
      const empty = document.createElement("div");
      empty.className = "fav-empty";
      empty.id = "fav-empty";
      const p1 = document.createElement("p");
      p1.textContent = "尚未收藏任何系列";
      const p2 = document.createElement("p");
      p2.className = "fav-empty-hint";
      p2.textContent = "點卡片右上角星號開始追蹤你關心的系列。";
      empty.append(p1, p2);
      list.appendChild(empty);
    } else {
      const frag = document.createDocumentFragment();
      for (const s of series) frag.appendChild(viewMode === "list" ? renderRow(s) : renderCard(s));
      list.appendChild(frag);
    }
    shownCount.textContent = String(series.length);
    // 分母語意：收藏分頁 = 目前年度可顯示收藏數；一般分頁 = 年度全部系列數。
    totalCount.textContent = String(group === "fav" ? currentYearFavCount(data) : data.series.length);
    humanizeAll();
```

- [ ] **Step 8: renderCard 加星號（grid 動態卡片）**

`renderCard` 內 `right.append(stat, rss)` 之前加：

```ts
    const fav = document.createElement("button");
    fav.className = "card-action card-fav"; fav.type = "button";
    fav.dataset.favId = String(s.id);
    fav.setAttribute("aria-pressed", String(favSet.has(s.id)));
    fav.setAttribute("aria-label", "收藏系列"); fav.title = "收藏系列";
    fav.appendChild(FAV_ICON.cloneNode(true));
```

改為 `right.append(fav, stat, rss);`。

- [ ] **Step 9: renderRow 加星號（list view）**

`renderRow` 內 `actions.append(rss, open)` 之前加：

```ts
    const fav = document.createElement("button");
    fav.className = "card-action card-fav"; fav.type = "button";
    fav.dataset.favId = String(s.id);
    fav.setAttribute("aria-pressed", String(favSet.has(s.id)));
    fav.setAttribute("aria-label", "收藏系列"); fav.title = "收藏系列";
    fav.appendChild(FAV_ICON.cloneNode(true));
```

改為 `actions.append(fav, rss, open);`。

- [ ] **Step 10: 事件委派 toggle handler**

`/* ---------- Events ---------- */` 的 `groupFilters?.addEventListener("click", ...)` 區塊加（`#series-list` 委派，與既有 `document.addEventListener("click", ...)` 處理 `[data-rss]` 並存）：

```ts
  list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".card-fav") as HTMLElement | null;
    if (!btn) return;
    e.preventDefault();
    const id = Number(btn.dataset.favId);
    // UI 層防禦（toggleFavorite 內亦 no-op，雙層守住邊界）。
    if (!isValidFavoriteId(id)) return;
    favSet = toggleFavorite(favSet, id);
    saveFavorites(storage, favSet);
    btn.setAttribute("aria-pressed", String(favSet.has(id)));
    btn.classList.remove("fav-pop"); void btn.offsetWidth; btn.classList.add("fav-pop");
    const favCount = document.getElementById("fav-count");
    if (favCount && current) favCount.textContent = String(currentYearFavCount(current));
    if (isFavView() && current) {
      // 收藏分頁：子集變了 → 重 render（取消收藏的卡片立即移出，空狀態由 applyFilter 重建）。
      applyFilter(current, "fav", (document.getElementById("sort") as HTMLSelectElement)?.value ?? "dayCount");
    }
  });
```

- [ ] **Step 11: 首輪同步 SSR 星號狀態**

`render((window as any).IRONMAN_DATA);` 之前加：

```ts
  // SSR 星號一律 aria-pressed="false"；首輪依 favSet 同步填色狀態（避免 FOUC）。
  document.querySelectorAll<HTMLElement>(".card-fav").forEach((b) => {
    const id = Number(b.dataset.favId);
    b.setAttribute("aria-pressed", String(favSet.has(id)));
  });
```

- [ ] **Step 12: fav-pop 動畫清理（animationend）**

`list.addEventListener("click", ...)` 之後加：

```ts
  list.addEventListener("animationend", (e) => {
    const t = e.target as HTMLElement;
    if (t.classList?.contains("fav-pop")) t.classList.remove("fav-pop");
  });
```

- [ ] **Step 13: Build + astro check + 既有測試**

Run: `cd web && bunx astro check && bun run build && cd .. && bun test`
Expected: astro check 乾淨、build 成功、`bun test` 全綠（既有 + Task 1 新增）。

- [ ] **Step 14: Commit**

```bash
git add web/src/components/Dashboard.astro
git commit -m "feat(web): favorites tab, star toggle, list-view support"
```

---

### Task 4: 收藏分頁 + 星號 + 空狀態 CSS

**Files:**
- Modify: `web/src/styles/design-system.css`

**Interfaces:**
- Consumes: Task 2/3 的 markup（`.card-fav`、`[aria-pressed="true"]`、`.fav-empty`、`#fav-count`）。

- [ ] **Step 1: 加星號 + 空狀態 + 收藏分頁醒目樣式**

`.card-action svg { ... }` 之後加：

```css
/* 收藏星號（grid + list 共用）——預設 outline，收藏時填色 + accent */
.card-fav svg { transition: fill 0.12s ease, color 0.12s ease; }
.card-fav[aria-pressed="true"] {
  color: var(--accent);
  background: var(--accent-weak);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.card-fav[aria-pressed="true"] svg { fill: currentColor; }
@keyframes fav-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.25); }
  100% { transform: scale(1); }
}
.fav-pop { animation: fav-pop 0.25s ease; }
@media (prefers-reduced-motion: reduce) {
  .fav-pop { animation: none; }
}
```

`.scrape-log ul { ... }` 之後加：

```css
/* 我的收藏：filter 按鈕醒目標記（星號）＋空狀態引導 */
.filter-btn[data-group="fav"] .filter-label::before {
  content: "☆ ";
  color: var(--accent);
}
.filter-btn[data-active="true"][data-group="fav"] .filter-label::before {
  content: "★ ";
}
.fav-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: var(--space-6);
  color: var(--muted);
  font-size: var(--text-sm);
}
.fav-empty-hint {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--muted);
  opacity: 0.8;
}
.fav-empty[hidden] { display: none; }
```

- [ ] **Step 2: Build 驗證**

Run: `cd web && bun run build`
Expected: build 成功（CSS 編譯無錯誤）。

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/design-system.css
git commit -m "style(web): favorites star, tab marker, empty state"
```

---

### Task 5: README 同步

**Files:**
- Modify: `README.md`

**Interfaces:**
- 無（文件同步）。

- [ ] **Step 1: 更新 Features 行 + Non-goals 行 + 註明僅限本裝置**

`README.md`：

1. Features 行（`- Features: year switcher ..., scrapeLog notice, responsive.`）加 favorites：

```md
- Features: year switcher (meta `years` authority), group filter + favorites tab, sort (dayCount / views / latest), client-side 60s refresh, scrapeLog notice, responsive.
```

2. Non-goals 行移除 `login/favorites/tracking`：

```md
- Non-goals (v1): search, real-time updates (periodic batch only).
```

3. 本地開發段後加「收藏」註明：

```md
## 收藏（Favorites）

卡片右上角星號可收藏系列；「我的收藏」分頁只顯示已收藏系列，沿用排序器。
收藏以系列 ID 為 key 跨年度共用，僅存於本裝置瀏覽器（localStorage），不同裝置/瀏覽器不互通。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README favorites + non-goals update"
```

---

### Task 6: 產品文件同步（PRODUCT.md）

**Files:**
- Modify: `PRODUCT.md`

**Interfaces:**
- 無（文件同步）。

- [ ] **Step 1: 更新 Roadmap + 功能描述**

`PRODUCT.md`：

1. Roadmap mid-term「Favorites / tracking specific series」標記完成：

```md
- [x] **Favorites / tracking specific series**（完成 2026-08-06）：localStorage 書籤（系列 ID 跨年度共用），卡片星號 toggle（grid/list 皆可），「我的收藏」分頁沿用排序器，空狀態引導；僅限本裝置/瀏覽器。
```

2. 儀表板能力描述（`**儀表板**（web/，Astro）` 段）加收藏：

```md
**儀表板**（`web/`，Astro）：SSG 預渲染 + client 端 60 秒刷新（於 Dashboard 元件），header 年度切換器、組別篩選 + 進度/最多觀看/今日發文排序、**「我的收藏」分頁（localStorage 書籤，系列 ID 跨年度共用）**，抓取失敗系列數以 scrapeLog notice 顯示。
```

- [ ] **Step 2: Commit**

```bash
git add PRODUCT.md
git commit -m "docs: mark favorites roadmap item done"
```

---

### Task 7: 端到端手動驗證（headless browser）

**Files:**
- 無（驗證）。

**Interfaces:**
- 驗證 Task 1–4 的整合行為。

- [ ] **Step 1: 啟動 preview server + 清空既有 localStorage**

Run: `cd web && bun run preview`（或 `bun run dev`），背景執行，記住 port（預設 4321）。

開啟瀏覽器後**先**執行（避免前次測試殘留造成非決定性結果）：

```js
localStorage.removeItem("ironman-observer:favorites");
localStorage.removeItem("view"); // 避免殘留 list view 影響初始 grid 驗證
location.reload();
```

- [ ] **Step 2: 驗證收藏流程（browser automation）**

1. 載入首頁 → 確認 `.card-fav` 出現、`aria-pressed="false"`、未填色；「我的收藏」tab 出現、`#fav-count` 0。
2. 點第一張卡片的星號 → **立即（同步）檢查**：`aria-pressed="true"`、填色（`fill: currentColor`）、`fav-pop` class 存在、`#fav-count` 1；`localStorage.getItem("ironman-observer:favorites")` 含該系列 id。
   - `fav-pop` 驗證時機：`animationend` 0.25s 後會移除 class——點擊後立刻讀取，不要等動畫結束。
   - 等待 `animationend`（約 0.3s）後確認 class 已被移除。
   - **prefers-reduced-motion 例外**：若系統設定 reduced-motion，`fav-pop` 動畫被 CSS 關閉（`animation: none`），class 可能因無動畫而不觸發 animationend——此模式下只驗證 `aria-pressed`/填色/localStorage，不驗證動畫 class。
3. 切到「我的收藏」分頁 → 只顯示該系列；切換排序（進度/最多觀看/今日發文）正常。
4. **空狀態再次出現**：取消最後一個收藏 → 卡片立即移出、空狀態「尚未收藏任何系列」出現（驗證 `applyFilter` 重建、非 SSR 殘留）、`shown-count` 顯示 `0 / 0`。
5. 重新整理 → 收藏保留（localStorage 持久）。
6. 切到 list view → 每列有 `.card-fav`、狀態與 grid 一致、可取消；切回 grid → 同步。
7. 無 console error；星號 focus 可見（鍵盤 Tab）。

- [ ] **Step 3: 年度切換驗證（如有第二年度資料）**

若有 `data/{other-year}.json` 且 meta.years 含之：

1. 在年度 A 收藏某系列 + active「我的收藏」分頁 → 切換年度 B → 仍停留在「我的收藏」分頁（active 不重設）、`#fav-count` 依新年度重算、新年度無對應收藏 → 空狀態 `0 / 0`。
2. **普通組別 fallback**：年度 A active 某組別（如「Software Development」）→ 切換到沒有該組別的年度 B → 該組別按鈕不存在、**「全部」為 active**、列表顯示年度 B 完整資料。
3. 年度 A/B 都有 fav 時 → fav 維持 active。

若只有 2026 一年，此步略過（無年度切換入口）。

- [ ] **Step 4: 收尾清理**

```js
localStorage.removeItem("ironman-observer:favorites");
```

停止 preview server；確認無殘留 process。

---

## Self-Review

**1. Spec coverage:**

| Spec 需求 | Task |
|---|---|
| favorites.ts API（StorageLike \| null、純函數 toggle、非法 id no-op、saveFavorites 契約） | Task 1 |
| loadFavorites 容錯（getter/getItem throw、非 array、逐項過濾、去重、不覆寫） | Task 1 |
| saveFavorites（null no-op、setItem throw 靜默） | Task 1 |
| SeriesCard 星號（SSR grid） | Task 2 |
| Dashboard 收藏分頁 SSR markup（button + fav-empty） | Task 3 Step 1 |
| Dashboard 收藏分頁 + fav-count + 空狀態（render output）+ 分母語意 | Task 3 Step 4/6/7 |
| list view 同款星號（renderRow） | Task 3 Step 9 |
| toggle 委派 + pop 動畫（含收藏分頁取消直接移除、空狀態重建） | Task 3 Step 10/12 |
| 年度切換保留 active + 組別 fallback「全部」+ fav-count 重算 | Task 3 Step 6 |
| SSR 首輪同步星號狀態 | Task 3 Step 11 |
| CSS（星號填色、pop、收藏 tab 醒目、空狀態） | Task 4 |
| README / PRODUCT 同步 | Task 5/6 |
| 端到端驗證（含 localStorage 清理、reduced-motion 例外、fallback 案例） | Task 7 |

**2. Placeholder scan:** 無 TBD/TODO；所有 code step 含完整 code block；驗證步驟有明確指令。

**3. Type consistency:**
- `StorageLike`（Task 1）→ `getStorage()` 回傳型別（Task 3 Step 2，`Pick<Storage, "getItem" | "setItem">` 相符）。
- `loadFavorites`/`saveFavorites`/`toggleFavorite`/`isValidFavoriteId` 在 Task 3 使用與 Task 1 定義一致。
- `favSeries`/`currentYearFavCount`/`currentGroup`/`isFavView`/`activeGroupFor` 在 render/applyFilter/toggle handler 使用一致。
- `renderFilters(groups, counts, activeGroup)` 第三參數改傳 `activeGroupFor(...)` 的 resolved 值（Task 3 Step 6）——`renderFilters` 內部以 `activeGroup` 設 `data-active`，後續 `applyFilter` 讀 `currentGroup()` 取得同一 resolved 值，一致。
- `applyFilter` 簽名不變（`(data, group, sort)`），toggle handler 呼叫 `applyFilter(current, "fav", sort)` 一致。
- `FAV_ICON` 在 renderCard/renderRow 皆以 `cloneNode(true)` 使用。
- `fav-pop` class 在 toggle handler 加、animationend 移除、CSS 定義、reduced-motion 關閉——四處一致。
- `#fav-empty`：SSR 輸出（hidden）→ 首次 render 被 `replaceChildren()` 移除 → `applyFilter` 在 fav 空子集時重建——生命週期一致（Task 3 Step 1/7/10）。
