# 多年度支援 + scrapeLog 錯誤提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scraper CLI 支援多年度（逐年度隔離 + atomic write）並產出年度選項權威來源 `meta.json`；UI 增加年度切換器與 scrapeLog 錯誤 notice（固定容器 + request token 防 race）。

**Architecture:** manifest 改年度陣列 → CLI 依序 `runScrape`（per-year try/catch、全失敗零寫入）→ `data/{year}.json` × N + `meta.json`（`years` 為 UI 唯一權威）→ `copy-data.mjs` clean+copy → Astro glob 年度資料，Dashboard 集中管理年度狀態（fetch token、filter 委派重建、scrapeLog 固定容器）。

**Tech Stack:** Bun + TypeScript（scraper）、Astro 5 static + native CSS（web）、bun:test。

## Global Constraints

- Zero-cost 契約：無後端、無 DB、JSON 即 DB；不改 workflow（`bun run scripts/scrape.ts` 已涵蓋多年度）。
- `runScrape` / `mergeCardsAndStats` / 各 parser / `fetch-html` / `daily-status.ts` / `SeriesCard.astro` 零變動。
- 資料一律純文字，parse 時 entity 解碼（`html-entities.ts`）；client DOM 一律 `textContent`，禁 `innerHTML` 放使用者/爬蟲資料。
- 空資料防護語意：年度 `series.length === 0` 算失敗，保留既有 `{year}.json` 不覆寫。
- 全年度失敗 → 完全不寫任何檔案、exit 1（既有資料與 meta 原樣）。
- `meta.years` = 成功寫檔年度 desc；`latestYear = years[0]`；UI 年度選項唯一權威 = `meta.years` ∩ 實際資料檔。
- 驗證門檻：`bun test` 全綠、`bunx tsc --noEmit` 乾淨、`cd web && bun run build` 成功。
- 文件三檔（README / PRODUCT / DEPLOYMENT-HANDOFF）多年度描述必須同步，不得留單年度矛盾。

---

### Task 1: Manifest 陣列 + MetaJson 型別

**Files:**
- Modify: `config/series-manifest.json`
- Modify: `scripts/types.ts`

**Interfaces:**
- Produces: `Manifest = { year: number; signupListUrl: string }`（entry 型別，不變）、`MetaJson = { latestYear: number; years: number[]; updatedAt: string; seriesCount: number }`。

- [ ] **Step 1: manifest 改陣列**

`config/series-manifest.json` 內容改為：

```json
[
  { "year": 2026, "signupListUrl": "https://ithelp.ithome.com.tw/2026ironman/signup/list" }
]
```

- [ ] **Step 2: types.ts 新增 MetaJson**

`scripts/types.ts` 現有 `Manifest` 型別之後追加：

```ts
export type MetaJson = {
  latestYear: number;   // years[0]（成功年度 desc 的第一個 = 最新）
  years: number[];      // 成功寫檔年度 desc 排序 —— UI 年度選項的唯一權威來源
  updatedAt: string;    // latestYear 年度資料的 updatedAt
  seriesCount: number;  // latestYear 年度資料的 seriesCount
};
```

- [ ] **Step 3: 型別檢查**

Run: `bunx tsc --noEmit`
Expected: 乾淨（scraper CLI 尚未改，仍以單一物件讀 manifest → 此刻可能有 `Manifest` 型別相容錯誤，屬預期，Task 2 修）。

- [ ] **Step 4: Commit**

```bash
git add config/series-manifest.json scripts/types.ts
git commit -m "feat: manifest as year array, add MetaJson type"
```

---

### Task 2: Scraper CLI — per-year 隔離 + atomic write

**Files:**
- Modify: `scripts/scrape.ts:86-110`（`import.meta.main` CLI entry）

**Interfaces:**
- Consumes: `runScrape(manifest: Manifest): Promise<YearData>`（不變）、`MetaJson`（Task 1）、`taipeiTimestamp`（現有）。
- Produces: CLI 行為 — 依序每年度 `runScrape`；年度失敗（rejection 或 `series.length === 0`）記錄 `console.error` 後繼續；至少一年成功才一次寫出全部成功年度 `data/{year}.json` + `meta.json`，exit 0；全失敗零寫入，exit 1。

- [ ] **Step 1: 重寫 CLI entry**

`scripts/scrape.ts` 的 `if (import.meta.main) { ... }` 整段替換為：

```ts
// CLI entry
if (import.meta.main) {
  const manifestPath = join(import.meta.dir, "..", "config", "series-manifest.json");
  const manifests: Manifest[] = JSON.parse(await readFile(manifestPath, "utf-8"));
  if (!Array.isArray(manifests) || manifests.length === 0) {
    console.error(`manifest must be a non-empty array: ${manifestPath}`);
    process.exit(1);
  }

  const dataDir = join(import.meta.dir, "..", "data");
  await mkdir(dataDir, { recursive: true });

  // Per-year isolation: runScrape rejection or empty result = year failure.
  // Keep writing until all years are attempted; decide writes atomically after.
  const succeeded: YearData[] = [];
  for (const m of manifests) {
    try {
      const data = await runScrape(m);
      if (data.series.length === 0) {
        console.error(`[${m.year}] scrape produced 0 series — keeping previous data, skipping write`);
        continue;
      }
      succeeded.push(data);
      console.log(`[${m.year}] scraped ${data.series.length} series`);
    } catch (e) {
      console.error(`[${m.year}] scrape failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (succeeded.length === 0) {
    // Atomic: nothing written, keep previous data/meta untouched.
    console.error("all years failed — aborting writes, keeping previous data");
    process.exit(1);
  }

  succeeded.sort((a, b) => b.year - a.year); // desc
  const latest = succeeded[0];
  for (const data of succeeded) {
    await writeFile(join(dataDir, `${data.year}.json`), JSON.stringify(data, null, 2));
  }
  const meta: MetaJson = {
    latestYear: latest.year,
    years: succeeded.map((d) => d.year),
    updatedAt: latest.updatedAt,
    seriesCount: latest.series.length,
  };
  await writeFile(join(dataDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`wrote ${succeeded.length} year file(s); latest ${latest.year} with ${latest.series.length} series`);
}
```

- [ ] **Step 2: 確認 import**

`scripts/scrape.ts` 頂部 import 確認含 `MetaJson` 型別：

```ts
import type { Manifest, Series, SignupCard, YearData, SeriesStats, RssChannel, MetaJson } from "./types";
```

- [ ] **Step 3: 型別檢查**

Run: `bunx tsc --noEmit`
Expected: 乾淨。

- [ ] **Step 4: 既有測試**

Run: `bun test scripts/scrape.test.ts`
Expected: 3 pass（`runScrape`/`mergeCardsAndStats` 未動）。

- [ ] **Step 5: 手動 dry-run（不打網）**

Run: `bun -e "import('./scripts/scrape.ts').then(async m => { const { readFile } = await import('node:fs/promises'); const manifests = JSON.parse(await readFile('config/series-manifest.json','utf-8')); const ok = manifests.length === 1 && manifests[0].year === 2026; console.log('manifest array:', ok); })"`
Expected: `manifest array: true`。

- [ ] **Step 6: Commit**

```bash
git add scripts/scrape.ts
git commit -m "feat(scraper): per-year isolation + atomic write in CLI"
```

---

### Task 3: 抽取可測的 CLI 純邏輯 + 單元測試

**Files:**
- Modify: `scripts/scrape.ts`
- Create: `scripts/scrape-cli.test.ts`

**Interfaces:**
- Consumes: `YearData`、`MetaJson`（Task 1）。
- Produces: `type ScrapeOutcome = { ok: true; data: YearData } | { ok: false; reason: string }`；`collectYears(manifests: Manifest[], run: (m: Manifest) => Promise<YearData>): Promise<{ succeeded: YearData[]; failures: string[] }>`（純函數，注入 run 以測 throw/空資料）；`buildMeta(succeeded: YearData[]): MetaJson`（純函數）。

- [ ] **Step 1: 寫失敗測試**

Create `scripts/scrape-cli.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { buildMeta, collectYears } from "./scrape";
import type { Manifest, YearData } from "./types";

const m2025: Manifest = { year: 2025, signupListUrl: "https://x/2025" };
const m2026: Manifest = { year: 2026, signupListUrl: "https://x/2026" };
const data = (year: number, n: number): YearData => ({
  year, updatedAt: `${year}-01-01 00:00:00+08:00`, groups: ["G"], series: Array.from({ length: n }, (_, i) => ({
    id: i, user: { id: 1, name: "u", profileUrl: "p" }, group: "G", title: "t", description: "d",
    team: null, signupDate: "2026-08-01T00:00:00+08:00", lastUpdated: null,
    dayCount: 0, articleCount: 0, subscriptions: 0, articles: [],
  })), scrapeLog: [],
});

describe("collectYears", () => {
  test("one throw, one ok: ok year survives, throw isolated", async () => {
    const { succeeded, failures } = await collectYears([m2025, m2026], async (m) => {
      if (m.year === 2025) throw new Error("signup fetch failed");
      return data(2026, 3);
    });
    expect(succeeded.map((d) => d.year)).toEqual([2026]);
    expect(failures).toEqual(["2025: signup fetch failed"]);
  });

  test("empty year counts as failure, keeps succeeded year", async () => {
    const { succeeded } = await collectYears([m2025, m2026], async (m) =>
      m.year === 2025 ? data(2025, 0) : data(2026, 3),
    );
    expect(succeeded.map((d) => d.year)).toEqual([2026]);
  });

  test("all years fail: succeeded empty", async () => {
    const { succeeded, failures } = await collectYears([m2025, m2026], async () => {
      throw new Error("boom");
    });
    expect(succeeded).toEqual([]);
    expect(failures).toHaveLength(2);
  });
});

describe("buildMeta", () => {
  test("years desc, latestYear = first, updatedAt/seriesCount from latest", () => {
    const meta = buildMeta([data(2025, 2), data(2026, 5)]);
    expect(meta.years).toEqual([2026, 2025]);
    expect(meta.latestYear).toBe(2026);
    expect(meta.seriesCount).toBe(5);
    expect(meta.updatedAt).toBe("2026-01-01 00:00:00+08:00");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun test scripts/scrape-cli.test.ts`
Expected: FAIL — `collectYears`/`buildMeta` 未定義。

- [ ] **Step 3: 實作純函數**

`scripts/scrape.ts` 的 `runScrape` 之後、CLI entry 之前插入：

```ts
// CLI pure helpers (injectable run for tests; no network).
export type ScrapeOutcome = { ok: true; data: YearData } | { ok: false; reason: string };
export async function collectYears(
  manifests: Manifest[],
  run: (m: Manifest) => Promise<YearData>,
): Promise<{ succeeded: YearData[]; failures: string[] }> {
  const succeeded: YearData[] = [];
  const failures: string[] = [];
  for (const m of manifests) {
    try {
      const data = await run(m);
      if (data.series.length === 0) {
        failures.push(`${m.year}: 0 series`);
        continue;
      }
      succeeded.push(data);
    } catch (e) {
      failures.push(`${m.year}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { succeeded, failures };
}

export function buildMeta(succeeded: YearData[]): MetaJson {
  const sorted = [...succeeded].sort((a, b) => b.year - a.year);
  const latest = sorted[0];
  return {
    latestYear: latest.year,
    years: sorted.map((d) => d.year),
    updatedAt: latest.updatedAt,
    seriesCount: latest.series.length,
  };
}
```

- [ ] **Step 4: CLI entry 改用純函數**

`scripts/scrape.ts` CLI entry 的 for 迴圈與 meta 建構替換為：

```ts
  const { succeeded } = await collectYears(manifests, runScrape);

  if (succeeded.length === 0) {
    console.error("all years failed — aborting writes, keeping previous data");
    process.exit(1);
  }

  const meta = buildMeta(succeeded);
  for (const data of succeeded) {
    await writeFile(join(dataDir, `${data.year}.json`), JSON.stringify(data, null, 2));
  }
  await writeFile(join(dataDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`wrote ${succeeded.length} year file(s); latest ${meta.latestYear} with ${meta.seriesCount} series`);
```

（`collectYears` 內部已含 per-year try/catch 與空資料判定，CLI 不再重複。）

- [ ] **Step 5: 跑測試確認通過**

Run: `bun test scripts/scrape-cli.test.ts`
Expected: 4 pass。

- [ ] **Step 6: 全測試 + 型別**

Run: `bun test && bunx tsc --noEmit`
Expected: 既有 18 pass + 新增 4 pass；型別乾淨。

- [ ] **Step 7: Commit**

```bash
git add scripts/scrape.ts scripts/scrape-cli.test.ts
git commit -m "feat(scraper): extract collectYears/buildMeta pure helpers with tests"
```

---

### Task 4: copy-data.mjs — clean + 多年度 glob copy

**Files:**
- Modify: `web/scripts/copy-data.mjs`

**Interfaces:**
- Consumes: `data/` 下所有 `^\d{4}\.json$` 檔（不含 meta.json）。
- Produces: `web/public/data/` 恰好含來源全部年度檔；先清除既有 `^\d{4}\.json$`（stale 防殘留）。

- [ ] **Step 1: 改寫 copy-data.mjs**

`web/scripts/copy-data.mjs` 整檔替換為：

```js
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = join(root, "data");
const outDir = join(root, "web", "public", "data");
mkdirSync(outDir, { recursive: true });

// Clean: remove previously copied year files so removed sources don't linger.
for (const f of readdirSync(outDir)) {
  if (/^\d{4}\.json$/.test(f)) rmSync(join(outDir, f));
}

// Copy every year data file (meta.json is intentionally NOT copied — client doesn't need it).
let copied = 0;
for (const f of readdirSync(dataDir)) {
  if (/^\d{4}\.json$/.test(f)) {
    copyFileSync(join(dataDir, f), join(outDir, f));
    copied++;
  }
}
console.log(`copied ${copied} year file(s) -> web/public/data`);
```

- [ ] **Step 2: 驗證 multi-year copy + clean + 干擾檔排除**

```bash
cd web && cp ../data/2026.json /tmp/2026.json && printf '{"year":2025,"updatedAt":"2025-01-01 00:00:00+08:00","groups":[],"series":[],"scrapeLog":[]}' > ../data/2025.json && echo '{}' > ../data/foo.json && echo '{}' > ../data/2026.backup.json && mkdir -p public/data && echo 'x' > public/data/2024.json && node scripts/copy-data.mjs && echo "--- public/data:" && ls public/data && rm ../data/2025.json ../data/foo.json ../data/2026.backup.json && mv /tmp/2026.json ../data/2026.json
```

Expected:
- `public/data/` 含 `2025.json`、`2026.json`；**不含** `2024.json`（stale 清除）、`meta.json`、`foo.json`、`2026.backup.json`。

- [ ] **Step 3: 清理驗證產物**

```bash
rm -f web/public/data/2025.json
```

- [ ] **Step 4: Commit**

```bash
git add web/scripts/copy-data.mjs
git commit -m "feat(web): clean+copy all year data files, exclude meta.json"
```

---

### Task 5: index.astro — 年度 glob + 移除 refresh script

**Files:**
- Modify: `web/src/pages/index.astro`

**Interfaces:**
- Consumes: `meta.json`（build 期 glob）、`data/{year}.json`（build 期 glob）。
- Produces: `years: number[]`（`meta.years` ∩ 實際資料檔 keys）、`latestYear`、初始 `data`；Dashboard props 增加 `years`。移除 `ironman-data` CustomEvent 與 60s refresh（移入 Dashboard）。

- [ ] **Step 1: frontmatter 改為 glob 年度資料 + meta**

`web/src/pages/index.astro` 的 frontmatter 替換為：

```astro
---
import Dashboard from "../components/Dashboard.astro";
import type { MetaJson, YearData } from "../../../scripts/types";

const dataByYear = new Map<number, YearData>();
for (const [path, mod] of Object.entries(import.meta.glob("../../../data/*.json", { eager: true, import: "default" }))) {
  const m = path.match(/(\d{4})\.json$/);
  if (m) dataByYear.set(Number(m[1]), mod as YearData);
}
const meta = (await import("../../../data/meta.json").then((m) => m.default)) as MetaJson;
// Authority: meta.years ∩ actually-present data files (defensive against stale meta).
const years = meta.years.filter((y) => dataByYear.has(y)).sort((a, b) => b - a);
const latestYear = years[0] ?? [...dataByYear.keys()].sort((a, b) => b - a)[0];
const data: YearData = dataByYear.get(latestYear)!;
---
```

- [ ] **Step 2: `<title>` 帶 year**

`<title>鐵人觀察家 2026</title>` → `<title>鐵人觀察家 {latestYear}</title>`。

- [ ] **Step 3: 移除 refresh script + CustomEvent**

`<body>` 尾端整段移除：

```html
  <script>
    // Refresh client-side: re-fetch JSON to pick up the latest hourly commit without full reload
    async function refresh() { ... }
    setInterval(refresh, 60_000); // every minute
  </script>
```

（refresh 邏輯移入 Dashboard，Task 6。）

- [ ] **Step 4: 傳 years prop**

`<Dashboard data={data} />` → `<Dashboard data={data} years={years} />`。

- [ ] **Step 5: 型別 + build**

Run: `bunx tsc --noEmit && cd web && bun run build`
Expected: 型別乾淨、build 成功（Dashboard 尚未接受 `years` prop 的錯誤此刻會出現——Task 6 一併修）。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/index.astro
git commit -m "feat(web): glob year data + meta authority in index page"
```

---

### Task 6: Dashboard — 年度切換器 + fetch token + filter 委派 + scrapeLog 容器

**Files:**
- Modify: `web/src/components/Dashboard.astro`
- Modify: `web/src/styles/design-system.css`（`.scrape-log` 樣式）

**Interfaces:**
- Consumes: `years: number[]` prop（Task 5）、`YearData`（不變）。
- Produces: `#year-select`（change → `loadYear`）、`#brand-year`、`#scrape-log`/`#scrape-log-count`/`#scrape-log-list`（固定容器）、`#group-filters` 容器委派、模組級 `fetchToken`、`loadYear(year)` + 60s interval、`renderFilters(groups, counts, activeGroup)`。

- [ ] **Step 1: Props + SSR markup**

`web/src/components/Dashboard.astro` frontmatter：

```astro
interface Props { data: YearData; years: number[] }
const { data, years } = Astro.props;
```

`header-actions` 最左新增：

```html
<select id="year-select" class="sort-select" aria-label="切換年度">
  {years.map((y) => <option value={y} selected={y === data.year}>{y} 年</option>)}
</select>
```

`brand-year` span 加 id：

```html
<span class="brand-year" id="brand-year">2026</span>
```

`status-bar` 內 `已顯示 ... 支系列` 之後新增固定容器：

```html
<details class="scrape-log" id="scrape-log" {data.scrapeLog.length === 0 ? "hidden" : ""}>
  <summary>⚠ <span id="scrape-log-count" class="tabular-nums">{data.scrapeLog.length}</span> 支系列本次抓取失敗</summary>
  <ul id="scrape-log-list">
    {data.scrapeLog.map((e) => <li>{e}</li>)}
  </ul>
</details>
```

- [ ] **Step 2: client script — 年度狀態 + token + loadYear**

`<script>` 頂部（`let current: any = null;` 附近）追加：

```ts
  let currentYear: number = (window as any).IRONMAN_DATA?.year ?? data.year;
  let fetchToken = 0;
  const yearSelect = document.getElementById("year-select") as HTMLSelectElement | null;
  const brandYear = document.getElementById("brand-year");
  const scrapeLog = document.getElementById("scrape-log");
  const scrapeLogCount = document.getElementById("scrape-log-count");
  const scrapeLogList = document.getElementById("scrape-log-list");
  let lastRenderedYear: number | null = null;

  async function loadYear(year: number) {
    const token = ++fetchToken;
    try {
      const res = await fetch(`/data/${year}.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const fresh = await res.json();
      if (token !== fetchToken) return; // stale response — a newer request owns the render
      render(fresh);
    } catch { /* keep current render */ }
  }
```

- [ ] **Step 3: render() 同步 year/select/brand/scrapeLog + filter 重建**

`render(data)` 開頭（`current = data;` 之後）插入：

```ts
    currentYear = data.year;
    if (yearSelect) yearSelect.value = String(data.year);
    if (brandYear) brandYear.textContent = String(data.year);
    // Rebuild group filters only when the year actually changed.
    if (lastRenderedYear !== data.year) {
      lastRenderedYear = data.year;
      renderFilters(data.groups, groupCounts(data), "全部");
    }
    // scrapeLog notice: fixed container, toggled by data.
    if (scrapeLog && scrapeLogCount && scrapeLogList) {
      scrapeLogCount.textContent = String(data.scrapeLog.length);
      scrapeLogList.textContent = "";
      for (const err of data.scrapeLog) {
        const li = document.createElement("li");
        li.textContent = err;
        scrapeLogList.appendChild(li);
      }
      scrapeLog.hidden = data.scrapeLog.length === 0;
    }
```

並在 `render` 之前定義 helpers：

```ts
  function groupCounts(data: any): Map<string, number> {
    const m = new Map<string, number>();
    for (const s of data.series) m.set(s.group, (m.get(s.group) ?? 0) + 1);
    return m;
  }
  function renderFilters(groups: string[], counts: Map<string, number>, activeGroup: string) {
    const wrap = document.getElementById("group-filters");
    if (!wrap) return;
    wrap.textContent = "";
    for (const g of groups) {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.dataset.group = g;
      btn.dataset.active = String(g === activeGroup);
      const label = document.createElement("span");
      label.className = "filter-label";
      label.textContent = g;
      const cnt = document.createElement("span");
      cnt.className = "filter-count tabular-nums";
      cnt.textContent = String(counts.get(g) ?? 0);
      btn.append(label, cnt);
      wrap.appendChild(btn);
    }
  }
```

（`data.groups` 含全部組別；「全部」按鈕由 `renderFilters` 首項 `g === "全部"` 處理——`groups` 參數須含 `"全部"` 首項，見 Step 4 呼叫端。）

- [ ] **Step 4: filter 事件委派 + 年度 select change + refresh interval**

現有 `document.querySelectorAll(".filter-btn").forEach(...)` 綁定區塊**整個替換**為容器委派：

```ts
  const groupFilters = document.getElementById("group-filters");
  groupFilters?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".filter-btn") as HTMLElement | null;
    if (!btn) return;
    groupFilters.querySelectorAll(".filter-btn").forEach((b) => b.setAttribute("data-active", "false"));
    btn.setAttribute("data-active", "true");
    if (current) applyFilter(current, btn.dataset.group!, (document.getElementById("sort") as HTMLSelectElement)?.value ?? "dayCount");
  });
```

`renderFilters` 呼叫端的 `groups` 參數 = `["全部", ...data.groups]`（改 Step 3 的呼叫為 `renderFilters(["全部", ...data.groups], groupCounts(data), "全部")`）。

`yearSelect` change + refresh interval（事件區塊內追加）：

```ts
  yearSelect?.addEventListener("change", () => {
    const y = Number(yearSelect.value);
    if (!Number.isInteger(y)) return;
    loadYear(y);
  });
  setInterval(() => { if (current) loadYear(currentYear); }, 60_000);
```

- [ ] **Step 5: 移除舊 refresh 依賴**

確認 client script 不再有 `window.addEventListener("ironman-data", ...)`（Task 5 已移除 dispatch；此 listener 移除，改為初始 `render`）：

```ts
  render((window as any).__SSR_DATA__ ?? (window as any).IRONMAN_DATA);
```

（保留既有 `setInterval(() => { today = taipeiToday(); humanizeAll(); }, 60000)` 不變。）

- [ ] **Step 6: `.scrape-log` 樣式**

`web/src/styles/design-system.css` 的 `.status-bar` 區塊之後追加：

```css
/* scrapeLog failure notice */
.scrape-log {
  font-family: var(--font-sans);
  font-size: var(--text-2xs);
  color: var(--danger);
  background: var(--danger-weak);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-2);
}
.scrape-log summary {
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.scrape-log summary::-webkit-details-marker { display: none; }
.scrape-log ul {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
  color: var(--danger);
}
```

- [ ] **Step 7: 型別 + build + 全測試**

Run: `bunx tsc --noEmit && cd web && bun run build && cd .. && bun test`
Expected: 全乾淨（`dashboard` client 內 `data`/`year` 等用 `any` 存取，無型別錯誤；Astro template 的 `hidden` 條件用三元字串合法）。

- [ ] **Step 8: Commit**

```bash
git add web/src/components/Dashboard.astro web/src/styles/design-system.css
git commit -m "feat(web): year switcher, fetch token, filter delegation, scrapeLog notice"
```

---

### Task 7: 文件同步（README / PRODUCT / DEPLOYMENT-HANDOFF）

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `docs/DEPLOYMENT-HANDOFF.md`

**Interfaces:**
- Consumes: Task 2–6 的實際行為（多年度、meta 語意、年度切換器、scrapeLog notice）。

- [ ] **Step 1: README.md 單年度 → 多年度**

- 架構段：`data/2026.json` → `data/{year}.json`（每年度一支）+ `meta.json`（`years` = 年度選項唯一權威）。
- 本地開發段：`bun run scripts/scrape.ts` 說明改為「依 `config/series-manifest.json` 陣列逐年度抓取；全失敗零寫入、exit 1」。
- 新增一句：「年度切換器（header select）以 `meta.json` 的 `years` 為唯一權威」。

- [ ] **Step 2: PRODUCT.md**

- Stack 段：`data/2026.json` → `data/{year}.json` + `meta.json`（`years` 權威）。
- Evidence 段：`data/2026.json` + `data/meta.json` 描述更新（meta 現含 `years`/`latestYear`）。
- Roadmap near-term：第 1、3 項標記完成（`[x]`），保留第 2 項（今日發文已完成——補標）。
- 加註 meta 語意：空資料年度保留舊檔、但選項縮小。

- [ ] **Step 3: DEPLOYMENT-HANDOFF.md**

- 架構段（line ~23）：`data/2026.json + meta.json` → 「每年度 `data/{year}.json` + `meta.json`（`years` 權威）」。
- 檔案地圖（line ~42-45）：scrape.ts 描述加「CLI 逐年度、per-year try/catch、atomic write」；index.astro 描述改「年度切換器 + 60s refresh 於 Dashboard」。
- 已知問題區：追加「多年度」小節，載明：meta 語意、空資料年度行為、refresh/切換 race 已由 request token 防護。

- [ ] **Step 4: 一致性檢查**

Run: `grep -rn "data/2026.json" README.md PRODUCT.md docs/DEPLOYMENT-HANDOFF.md`
Expected: 僅剩「既有/相容」語意的合理提及（例如證據段描述現有資料），無「架構上只有 2026」的陳述。

- [ ] **Step 5: Commit**

```bash
git add README.md PRODUCT.md docs/DEPLOYMENT-HANDOFF.md
git commit -m "docs: multi-year + scrapeLog in README/PRODUCT/handoff"
```

---

### Task 8: 全驗證 + 手動 headless 檢查

**Files:**
- 無（僅執行驗證）。

**Interfaces:**
- Consumes: Task 1–7 全部產出。

- [ ] **Step 1: 全測試 + 型別 + build**

Run: `bun test && bunx tsc --noEmit && cd web && bun run build && cd ..`
Expected: 全綠；`web/public/data/` 含 `2026.json`、不含 `meta.json`。

- [ ] **Step 2: 合成 2025 年度 — 切換器出現且切換正確**

```bash
cp data/2026.json /tmp/2026.json && node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('data/2026.json','utf-8'));
d.year=2025; d.series=d.series.slice(0,3);
fs.writeFileSync('data/2025.json', JSON.stringify(d));
fs.writeFileSync('data/meta.json', JSON.stringify({latestYear:2026,years:[2026,2025],updatedAt:d.updatedAt,seriesCount:d.series.length}));
"
cd web && bun run build && cd ..
```

Run headless browser（Playwright/puppeteer，`npx astro preview` 或 `file://` dist 目錄亦可）：
- 載入 → `#year-select` 有 `2026 年`、`2025 年` 兩選項、value = 2026。
- 切到 2025 → brand-year 顯示 2025、series-count = 3、filter chips 重建（只含該年度組別）、點一個 filter 正常篩選。
- 切回 2026 → 還原 127 系列、filter 恢復。
- 無 console error。

- [ ] **Step 3: scrapeLog transition + race**

- 初始空（現況）：`#scrape-log` 有 `hidden`。
- 注入錯誤：`node -e "const fs=require('fs');const p='web/public/data/2026.json';const d=JSON.parse(fs.readFileSync(p,'utf-8'));d.scrapeLog=['9066: HTTP 403','9101: timeout'];fs.writeFileSync(p,JSON.stringify(d));"` → 手動 `loadYear` 或等 60s refresh → `#scrape-log` 出現、count = 2、展開兩條錯誤、無 XSS（list 內容 = text）。
- 還原：`mv /tmp/2026.json data/2026.json && cd web && bun run build && cd ..` → refresh 後 `hidden` 回來。
- Race：DevTools 網路 throttling 下快速 2026→2025→2026，或直接以不同延遲模擬兩次 `loadYear` 反序完成 → 最終畫面 = 最後一次呼叫的年度、`#year-select.value` 一致。

- [ ] **Step 4: 清理合成產物**

```bash
rm -f data/2025.json data/foo.json data/2026.backup.json web/public/data/2024.json web/public/data/2025.json
git status --short
```

Expected: 工作樹乾淨（除既定變更）。

- [ ] **Step 5: 最終 commit（若有殘留）**

```bash
git add -A && git commit -m "chore: finalize multi-year + scrapeLog verification" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage:**
- §1.1 manifest 陣列 + MetaJson → Task 1
- §1.2 per-year 隔離 + atomic → Task 2/3（純函數 + 測試）
- §1.3 copy-data clean + glob → Task 4
- §1.4 index glob + meta 權威 + 移除 refresh → Task 5
- §1.5 年度切換器 + render 同步 → Task 6
- §1.6 filter 委派重建 → Task 6 Step 4
- §1.7 request token + loadYear → Task 6 Step 2
- §2 scrapeLog 固定容器 → Task 6 Step 1/3
- §3 文件三檔 → Task 7
- §4.1 單元測試 → Task 3
- §4.2 build 驗證 → Task 4 Step 2、Task 8 Step 2
- §4.4 headless → Task 8 Step 2/3

**2. Placeholder scan:** 無 TBD/TODO；所有 code step 含完整程式碼；「類似 Task N」未使用。

**3. Type consistency:** `MetaJson`（Task 1）→ `buildMeta` 回傳（Task 3）→ index.astro 使用（Task 5）一致；`collectYears` 回傳 `{ succeeded, failures }` 在 Task 3 測試與 CLI 使用一致；`renderFilters(groups, counts, activeGroup)` 呼叫端（Step 3/4）一致；`loadYear(year)` 在 change handler 與 interval 共用一致。
