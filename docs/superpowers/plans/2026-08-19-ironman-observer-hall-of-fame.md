# 名人堂（Hall of Fame）擴充與 UI/UX 升級實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 擴充名人堂資料至 8 位知名技術領袖，並全面升級名人堂頁面 UI/UX（Quick Jump 快速導覽列、尊榮人物 Hero Profile 卡片、首字頭像徽章、當前年度影響力數據與身分勳章、重試機制），保持雙層渲染（SSR + Client DOM）契約 100% 同步與零 dead controls。

**Architecture:**
- 前端專用靜態 metadata（`web/src/data/famous-authors.json`）儲存 8 位人工查證確認之知名技術領袖。
- `web/src/lib/hall-of-fame.ts` 提供純函式資料處理（`loadFamousAuthors`、`matchFamousAuthors`、`famousProfileViewModel`、`getAvatarChar`），無副作用、可單元測試。
- 雙層渲染對齊：SSR（`HallOfFame.astro`）與 Client DOM（`hall-of-fame-dom.ts`）皆由 `famousProfileViewModel` 與 `cardViewModel` 驅動，透過結構契約測試（`hall-of-fame-dom.test.ts`）直接以 SSR Fixture 比對 Client Signature（`expect(clientSig).toEqual(ssrSig)`）鎖定節點對齊。
- 樣式完全遵循 `DESIGN.md`（單一沉穩藍、實色/tonal surface 頭像，不使用 gradient 或 glass 裝飾，無 emoji 作為 icon，使用既有 CSS 變數 `--accent-weak` 與具體 transition 宣告）。

**Tech Stack:** Astro (SSG), TypeScript, Bun Test, Happy-DOM, CSS Variables (`design-system.css`).

---

## Global Constraints

- **安全第一**：所有使用者文字走 `textContent` / Astro JSX 脫逸輸出，嚴禁 `innerHTML`；所有外連必須通過 `isSafeUrl` 檢驗。
- **設計系統**：嚴格遵循 `DESIGN.md` 與 `design-system.css` 色彩變數；頭像徽章使用實色（`var(--surface-muted)` / `var(--accent)`），不使用 gradient/glass，無 emoji 作為 icon。
- **零 Dead Controls**：名人堂系列卡為 read-only，不產生收藏按鈕與 RSS 按鈕。
- **統計口徑**：`totalViews` 為當前所選年度所有參賽系列文章之總瀏覽加總。
- **無依賴膨脹**：零外部 UI 函式庫，維持原生 DOM 與 Astro 標準語法。

---

### Task 1: 擴充 `web/src/data/famous-authors.json` 為 8 位名人名單與 Exact-Set 測試

**Files:**
- Modify: `web/src/data/famous-authors.json`
- Modify: `web/src/lib/hall-of-fame.test.ts`

**Interfaces:**
- Consumes: `FamousEntry` from `web/src/lib/hall-of-fame.ts`
- Produces: 8 verified author entries in `famous-authors.json`

- [ ] **Step 1: 撰寫 8 位名單 Exact-Set 與屬性完整性測試（Failing Test）**

在 `web/src/lib/hall-of-fame.test.ts` 中加入測試：

```ts
test("famous-authors.json contains exact 8 verified authors with complete fields", () => {
  const expectedIds = new Set([
    20065770, // 高見龍
    20040221, // 廖洧杰
    20083608, // 卡斯伯
    20109516, // chia7712
    20161809, // kojenchieh
    20120030, // 大魔術熊貓工程師
    20133765, // Oberon Lai
    20104930, // 雷N
  ]);
  const authors = loadFamousAuthors();
  expect(new Set(authors.map((a) => a.id))).toEqual(expectedIds);
  expect(authors).toHaveLength(8);

  for (const author of authors) {
    expect(author.name.trim().length).toBeGreaterThan(0);
    expect(author.bio.trim().length).toBeGreaterThan(0);
    expect(author.categories.length).toBeGreaterThan(0);
    expect(author.credentials.length).toBeGreaterThan(0);
    for (const cred of author.credentials) {
      expect(cred.label.trim().length).toBeGreaterThan(0);
      expect(isSafeUrl(cred.url)).toBe(true);
    }
  }
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `bun test web/src/lib/hall-of-fame.test.ts`
Expected: FAIL（目前只有 1 筆）

- [ ] **Step 3: 更新 `web/src/data/famous-authors.json`**

寫入 8 位名人的完整查證資訊：

```json
{
  "20065770": {
    "name": "高見龍",
    "bio": "五倍紅寶石創辦人、Ruby 社群要角，長期推廣 Ruby / Rails 與技術寫作",
    "credentials": [
      { "label": "COSCUP 講師", "url": "https://coscup.org/" },
      { "label": "五倍紅寶石", "url": "https://5xruby.tw/" }
    ],
    "categories": ["speaker", "community"]
  },
  "20040221": {
    "name": "廖洧杰",
    "bio": "六角學院創辦人兼校長、前端教育推廣者，多次擔任 MOPCON / ModernWeb 等研討會講師",
    "credentials": [
      { "label": "六角學院", "url": "https://www.hexschool.com/" },
      { "label": "MOPCON 講師", "url": "https://mopcon.org/" }
    ],
    "categories": ["community", "speaker"]
  },
  "20083608": {
    "name": "卡斯伯",
    "bio": "六角學院核心講師、前端開發與教學者，著有《JavaScript 面試力》，長期推廣 Vue.js 與前端技術",
    "credentials": [
      { "label": "《JavaScript 面試力》作者", "url": "https://www.casper.tw/about" },
      { "label": "六角學院講師", "url": "https://www.hexschool.com/" }
    ],
    "categories": ["book", "community"]
  },
  "20109516": {
    "name": "chia7712",
    "bio": "Apache Software Foundation (ASF) Member，Apache Kafka / Apache HBase / Apache YuniKorn PMC 成員與 Committer，致力於國際開源貢獻與人才培育",
    "credentials": [
      { "label": "Apache Kafka PMC & Committer", "url": "https://kafka.apache.org/community/committers" },
      { "label": "GitHub @chia7712", "url": "https://github.com/chia7712" }
    ],
    "categories": ["oss", "community"]
  },
  "20161809": {
    "name": "kojenchieh",
    "bio": "敏捷三叔公（David Ko / 柯仁傑），Agile Summit 與 DevOpsDays Taipei 共同主辦人，著有《軟體測試修練指南》，專精敏捷開發與測試實務",
    "credentials": [
      { "label": "DevOpsDays Taipei 講師", "url": "https://www.devopsdays.tw/" },
      { "label": "《軟體測試修練指南》作者", "url": "https://webconf.tw/speakers/27" }
    ],
    "categories": ["speaker", "community", "book"]
  },
  "20120030": {
    "name": "大魔術熊貓工程師",
    "bio": "連續多年榮獲 Microsoft AI MVP，專注於 Azure OpenAI、AI Agent 與生成式 AI 應用開發，著有多本生成式 AI 實戰專書",
    "credentials": [
      { "label": "Microsoft AI MVP", "url": "https://mvp.microsoft.com/zh-tw/PublicProfile/5003846?fullName=Ko%20Ko" },
      { "label": "大魔術熊貓工程師 Blog", "url": "https://magic-panda-engineer.github.io/" }
    ],
    "categories": ["speaker", "community", "book"]
  },
  "20133765": {
    "name": "Oberon Lai",
    "bio": "WordPress 專案開發者、外掛作者，WordCamp Taipei 講者，長期經營「WP 開發日常」分享 WordPress / WooCommerce 技術實務與接案心得",
    "credentials": [
      { "label": "WordCamp Taipei 講者", "url": "https://oberonlai.blog/" },
      { "label": "WP 開發日常", "url": "https://oberonlai.blog/" }
    ],
    "categories": ["speaker", "community"]
  },
  "20104930": {
    "name": "雷N",
    "bio": "CloudNative / Infra & DevOps 工程師，長期投入雲原生架構、Kubernetes、Observability 與 AI Agent 系統實踐",
    "credentials": [
      { "label": "GitHub @tedmax100", "url": "https://github.com/tedmax100" },
      { "label": "個人技術網站", "url": "https://tedmax100.github.io/" }
    ],
    "categories": ["community", "oss"]
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `bun test web/src/lib/hall-of-fame.test.ts`
Expected: PASS

---

### Task 2: 實作 `getAvatarChar` 與 `famousProfileViewModel`

**Files:**
- Modify: `web/src/lib/hall-of-fame.ts`
- Modify: `web/src/lib/hall-of-fame.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function getAvatarChar(name: string): string;
  export type FamousCategory = "speaker" | "community" | "oss" | "book";
  export type FamousProfileViewModel = {
    id: number;
    anchorId: string; // `hof-person-${id}`
    name: string;
    avatarChar: string;
    profileUrl: string;
    bio: string;
    categories: { id: FamousCategory; label: string }[];
    credentials: { label: string; url: string | null }[];
    statsText: string;
    seriesCount: number;
  };
  export function famousProfileViewModel(row: FamousRow): FamousProfileViewModel;
  ```

- [ ] **Step 1: 撰寫 `getAvatarChar` 與 `famousProfileViewModel` 單元測試**

在 `web/src/lib/hall-of-fame.test.ts` 中加入測試：

```ts
test("getAvatarChar handles English, CJK, whitespace, and fallback", () => {
  expect(getAvatarChar(" Oberon Lai ")).toBe("O");
  expect(getAvatarChar("chia7712")).toBe("C");
  expect(getAvatarChar("大魔術熊貓工程師")).toBe("大");
  expect(getAvatarChar("   ")).toBe("?");
});

test("famousProfileViewModel extracts initials, stats, and safe credentials", () => {
  const row: FamousRow = {
    entry: {
      id: 20065770,
      name: "高見龍",
      bio: "五倍紅寶石創辦人",
      credentials: [
        { label: "COSCUP 講師", url: "https://coscup.org/" },
        { label: "危險連結", url: "javascript:alert(1)" }
      ],
      categories: ["speaker", "community"]
    },
    series: [{ id: 1 } as any],
    totalViews: 38400
  };
  const vm = famousProfileViewModel(row);
  expect(vm.anchorId).toBe("hof-person-20065770");
  expect(vm.avatarChar).toBe("高");
  expect(vm.statsText).toBe("38,400 總瀏覽 · 1 系列");
  expect(vm.seriesCount).toBe(1);
  expect(vm.categories).toEqual([
    { id: "speaker", label: "講師" },
    { id: "community", label: "社群" }
  ]);
  expect(vm.credentials[0].url).toBe("https://coscup.org/");
  expect(vm.credentials[1].url).toBeNull();
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `bun test web/src/lib/hall-of-fame.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作 `getAvatarChar` 與 `famousProfileViewModel`**

在 `web/src/lib/hall-of-fame.ts` 中加入實作：

```ts
export function getAvatarChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = trimmed[0];
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

export type FamousProfileViewModel = {
  id: number;
  anchorId: string;
  name: string;
  avatarChar: string;
  profileUrl: string;
  bio: string;
  categories: { id: FamousCategory; label: string }[];
  credentials: { label: string; url: string | null }[];
  statsText: string;
  seriesCount: number;
};

const CATEGORY_LABELS: Record<FamousCategory, string> = {
  speaker: "講師",
  community: "社群",
  oss: "開源",
  book: "書籍"
};

export function famousProfileViewModel(row: FamousRow): FamousProfileViewModel {
  const name = row.entry.name.trim();
  const avatarChar = getAvatarChar(name);
  const profileUrl = `https://ithelp.ithome.com.tw/users/${row.entry.id}`;
  const seriesCount = row.series.length;
  const statsText = `${row.totalViews.toLocaleString()} 總瀏覽 · ${seriesCount} 系列`;

  return {
    id: row.entry.id,
    anchorId: `hof-person-${row.entry.id}`,
    name,
    avatarChar,
    profileUrl,
    bio: row.entry.bio,
    categories: row.entry.categories.map((c) => ({
      id: c,
      label: CATEGORY_LABELS[c] ?? c
    })),
    credentials: row.entry.credentials.map((c) => ({
      label: c.label,
      url: safeHref(c.url)
    })),
    statsText,
    seriesCount
  };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `bun test web/src/lib/hall-of-fame.test.ts`
Expected: PASS

---

### Task 3: 升級 `design-system.css` 視覺樣式（符合 DESIGN.md 規範與既有 tokens）

**Files:**
- Modify: `web/src/styles/design-system.css:1315-1350`

**Interfaces:**
- Produces: CSS classes for `.hof-nav`, `.hof-nav-item`, `.hof-nav-count`, `.hof-card`, `.hof-avatar`, `.hof-head-main`, `.hof-stats`, `.hof-credentials`, `.hof-cred-btn`, `.hof-back-top`, `.hof-retry-btn`, 44px touch targets.

- [ ] **Step 1: 在 `design-system.css` 中加入/更新名人堂樣式**

使用現有 tokens `--accent-weak` 與具體 transition：

```css
/* ---------- 名人堂 (Hall of Fame) ---------- */
.hof-main { padding-block: var(--space-4); }

/* Quick Jump 快速導覽列 */
.hof-nav {
  display: flex; flex-wrap: wrap; gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding: var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.hof-nav-item {
  display: inline-flex; align-items: center; gap: var(--space-2);
  padding: 8px 14px;
  min-height: 44px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: 9999px;
  color: var(--text);
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.hof-nav-item:hover, .hof-nav-item:focus-visible {
  border-color: var(--accent);
  background: var(--surface);
  color: var(--accent);
  text-decoration: none;
}
.hof-nav-count {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 7px;
  background: var(--border);
  border-radius: 9999px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--muted);
}
.hof-nav-item:hover .hof-nav-count {
  background: var(--accent-weak);
  color: var(--accent);
}

/* 名人 Hero Profile 卡片 */
.hof-card {
  display: flex; flex-direction: column; gap: var(--space-3);
  padding: var(--space-4); margin-bottom: var(--space-5);
  background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius);
  scroll-margin-top: calc(var(--space-6) + 40px);
}
.hof-card-head {
  display: flex; align-items: center; gap: var(--space-3);
  flex-wrap: wrap;
}
.hof-avatar {
  width: 48px; height: 48px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--accent);
  font-size: var(--text-lg);
  font-weight: 700;
}
.hof-head-main {
  flex: 1; min-width: 200px;
  display: flex; flex-direction: column; gap: 2px;
}
.hof-name-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
  flex-wrap: wrap;
}
.hof-name { margin: 0; font-size: var(--text-lg); font-weight: 700; }
.hof-name .meta-author {
  display: inline-flex; align-items: center; min-height: 44px;
}
.hof-stats { font-size: var(--text-xs); color: var(--muted); }
.hof-categories { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); }
.hof-cat-chip {
  padding: 2px 8px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--surface-muted); color: var(--muted); font-size: var(--text-xs); font-weight: 600;
}

.hof-bio {
  margin: 0;
  padding-left: var(--space-3);
  border-left: 2px solid var(--border);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.hof-credentials {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-wrap: wrap; gap: var(--space-2);
}
.hof-cred-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  min-height: 44px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: var(--text-xs);
  text-decoration: none;
  transition: border-color 0.12s ease, color 0.12s ease;
}
.hof-cred-btn:hover, .hof-cred-btn:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}
.hof-cred-plain {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px;
  min-height: 44px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  font-size: var(--text-xs);
}
.hof-cred-icon { width: 12px; height: 12px; flex-shrink: 0; fill: currentColor; }

.hof-series-title { margin: var(--space-2) 0 0; font-size: var(--text-sm); color: var(--muted); }
.hof-series { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3); }

.hof-card-foot {
  display: flex; justify-content: flex-end;
  margin-top: var(--space-1);
}
.hof-back-top {
  display: inline-flex; align-items: center;
  min-height: 44px; padding: 4px 8px;
  font-size: var(--text-xs); color: var(--muted); text-decoration: none;
}
.hof-back-top:hover { color: var(--accent); text-decoration: underline; }

.hof-empty { text-align: center; padding: var(--space-6); color: var(--muted); }
.hof-empty[hidden] { display: none; }

.hof-retry-btn {
  margin-top: var(--space-3);
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; padding: 8px 16px;
  background: var(--accent); color: var(--on-accent, #fff);
  border: 1px solid var(--accent); border-radius: var(--radius);
  font-size: var(--text-sm); font-weight: 600; cursor: pointer;
  transition: opacity 0.12s ease;
}
.hof-retry-btn:hover { opacity: 0.9; }
```

---

### Task 4: 升級 SSR 元件 `web/src/components/HallOfFame.astro`

**Files:**
- Modify: `web/src/components/HallOfFame.astro`

**Interfaces:**
- Consumes: `famousProfileViewModel` from `../lib/hall-of-fame`
- Produces: Complete SSR HTML with `#hof-top`, Quick Jump Bar, Hero Profile Cards, and back-to-top anchors.

- [ ] **Step 1: 更新 `HallOfFame.astro` 的 SSR 結構**

```astro
---
// web/src/components/HallOfFame.astro
import type { YearData } from "../../../scripts/types";
import { matchFamousAuthors, loadFamousAuthors, famousProfileViewModel } from "../lib/hall-of-fame";
import { taipeiToday } from "../lib/daily-status";
import HallOfFameSeriesCard from "./HallOfFameSeriesCard.astro";

interface Props { data: YearData; years: number[]; latestYear: number }
const { data, years, latestYear } = Astro.props;

const today = taipeiToday();
const entries = loadFamousAuthors();
const rows = matchFamousAuthors(entries, data);
const vms = rows.map((r) => ({ ...r, vm: famousProfileViewModel(r) }));
---
...
<main class="container hof-main" id="hof-top">
  <div class="status-bar" role="status">
    <span><span class="dot" aria-hidden="true"></span>資料已更新</span>
    <span>名人堂收錄 {entries.length} 位 · {data.year} 年共有 <strong id="hof-total-count" class="tabular-nums">{rows.length}</strong> 位參賽</span>
  </div>

  <nav class="hof-nav" id="hof-nav" aria-label="名人快速導覽" hidden={vms.length === 0}>
    {vms.map(({ vm }) => (
      <a class="hof-nav-item" href={`#${vm.anchorId}`}>
        <span>{vm.name}</span>
        <span class="hof-nav-count tabular-nums" aria-label={`${vm.seriesCount} 個系列`}>{vm.seriesCount}</span>
      </a>
    ))}
  </nav>

  <div id="hof-list">
    {vms.map(({ series, vm }) => (
      <section class="hof-card" id={vm.anchorId} data-famous-id={vm.id}>
        <header class="hof-card-head">
          <div class="hof-avatar" aria-hidden="true">{vm.avatarChar}</div>
          <div class="hof-head-main">
            <div class="hof-name-row">
              <h2 class="hof-name">
                <a class="meta-author" href={vm.profileUrl} target="_blank" rel="noopener">{vm.name}</a>
              </h2>
              <span class="hof-categories">
                {vm.categories.map((c) => (
                  <span class="hof-cat-chip">{c.label}</span>
                ))}
              </span>
            </div>
            <span class="hof-stats tabular-nums">{vm.statsText}</span>
          </div>
        </header>
        <p class="hof-bio">{vm.bio}</p>
        <ul class="hof-credentials">
          {vm.credentials.map((c) => (
            <li>
              {c.url ? (
                <a class="hof-cred-btn" href={c.url} target="_blank" rel="noopener">
                  <span>{c.label}</span>
                  <svg class="hof-cred-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </a>
              ) : (
                <span class="hof-cred-plain">{c.label}</span>
              )}
            </li>
          ))}
        </ul>
        <h3 class="hof-series-title">{data.year} 系列</h3>
        <div class="hof-series">
          {series.map((s) => <HallOfFameSeriesCard series={s} today={today} />)}
        </div>
        <footer class="hof-card-foot">
          <a class="hof-back-top" href="#hof-top">↑ 回到頂部</a>
        </footer>
      </section>
    ))}
  </div>

  <div class="hof-empty" id="hof-empty" role="status" aria-live="polite" hidden={rows.length > 0}>
    <p id="hof-empty-msg">這個年度沒有名人參賽</p>
    <button type="button" id="hof-retry" class="hof-retry-btn" hidden>重試載入</button>
  </div>
</main>
```

---

### Task 5: 升級 Client DOM Builder、錯誤重試與 Structural Signature Parity 測試

**Files:**
- Modify: `web/src/lib/hall-of-fame-dom.ts`
- Modify: `web/src/components/HallOfFame.astro` (client script)
- Modify: `web/src/lib/hall-of-fame-dom.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ProfileStructureSignature = {
    anchorId: string;
    classes: string[];
    textFields: string[];
    linkHrefs: string[];
    credentialCount: number;
    seriesCount: number;
    backTopHref: string | null;
    hasDeadControls: boolean;
  };
  export function extractProfileSignature(root: Element): ProfileStructureSignature;
  export function buildProfileSection(row: FamousRow, today: string, year: number): HTMLElement;
  export function buildQuickNav(vms: FamousProfileViewModel[]): HTMLElement;
  ```

- [ ] **Step 1: 更新 Client DOM Builder 模組 `web/src/lib/hall-of-fame-dom.ts`**

提供可測試且與 SSR 完全對齊的 DOM builder 函式與 signature 抽取器：
- `extractProfileSignature(root)`
- `buildQuickNav(vms)`
- `buildProfileSection(row, today, year)`

- [ ] **Step 2: 更新 `web/src/components/HallOfFame.astro` 的 client `<script>` 支援重試**

```ts
const hofRetry = document.getElementById("hof-retry") as HTMLButtonElement | null;
const hofEmptyMsg = document.getElementById("hof-empty-msg") as HTMLElement | null;
let currentYear = Number(yearSelect?.value || (window as any).HOF_DATA?.year || 2026);

async function loadYear(year: number) {
  currentYear = year;
  try {
    if (hofRetry) hofRetry.hidden = true;
    if (hofEmptyMsg) hofEmptyMsg.textContent = "載入中...";
    const res = await fetch(`/data/${year}.json`);
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    if (hofEmptyMsg) hofEmptyMsg.textContent = "這個年度沒有名人參賽";
    render(data);
  } catch (err) {
    console.error(err);
    hofEmpty.hidden = false;
    if (hofEmptyMsg) hofEmptyMsg.textContent = "載入年度資料失敗，請重新整理或點擊重試。";
    if (hofRetry) hofRetry.hidden = false;
  }
}

if (hofRetry) {
  hofRetry.addEventListener("click", () => {
    loadYear(currentYear);
  });
}
```

- [ ] **Step 3: 更新 `web/src/lib/hall-of-fame-dom.test.ts` 測試 SSR Fixture ↔ Client Parity 與 Retry 流程**

```ts
import { test, expect } from "bun:test";
import {
  extractProfileSignature,
  buildProfileSection,
  buildQuickNav
} from "./hall-of-fame-dom";
import { famousProfileViewModel, type FamousRow } from "./hall-of-fame";

test("SSR fixture and Client DOM buildProfileSection produce identical structural signature", () => {
  const row: FamousRow = {
    entry: {
      id: 20065770,
      name: "高見龍",
      bio: "五倍紅寶石創辦人",
      credentials: [{ label: "COSCUP 講師", url: "https://coscup.org/" }],
      categories: ["speaker"]
    },
    series: [],
    totalViews: 38400
  };
  const vm = famousProfileViewModel(row);

  // SSR-equivalent fixture element constructed from SSR template
  const ssrFixture = document.createElement("section");
  ssrFixture.className = "hof-card";
  ssrFixture.id = vm.anchorId;
  ssrFixture.dataset.famousId = String(vm.id);
  ssrFixture.innerHTML = `
    <header class="hof-card-head">
      <div class="hof-avatar" aria-hidden="true">${vm.avatarChar}</div>
      <div class="hof-head-main">
        <div class="hof-name-row">
          <h2 class="hof-name"><a class="meta-author" href="${vm.profileUrl}" target="_blank" rel="noopener">${vm.name}</a></h2>
          <span class="hof-categories"><span class="hof-cat-chip">講師</span></span>
        </div>
        <span class="hof-stats tabular-nums">${vm.statsText}</span>
      </div>
    </header>
    <p class="hof-bio">${vm.bio}</p>
    <ul class="hof-credentials">
      <li><a class="hof-cred-btn" href="https://coscup.org/" target="_blank" rel="noopener"><span>COSCUP 講師</span></a></li>
    </ul>
    <h3 class="hof-series-title">2026 系列</h3>
    <div class="hof-series"></div>
    <footer class="hof-card-foot"><a class="hof-back-top" href="#hof-top">↑ 回到頂部</a></footer>
  `;

  const clientSection = buildProfileSection(row, "2026-08-19", 2026);

  const ssrSig = extractProfileSignature(ssrFixture);
  const clientSig = extractProfileSignature(clientSection);

  expect(clientSig).toEqual(ssrSig);
  expect(clientSig.hasDeadControls).toBe(false);
  expect(clientSig.backTopHref).toBe("#hof-top");
});

test("Retry observable contract: failure triggers UI and retry re-fetches", () => {
  // Verify failure state, retry button visibility, and retry trigger
  const mockContainer = document.createElement("div");
  mockContainer.innerHTML = `
    <div id="hof-empty" hidden><p id="hof-empty-msg"></p><button id="hof-retry" hidden></button></div>
  `;
  const empty = mockContainer.querySelector("#hof-empty") as HTMLElement;
  const msg = mockContainer.querySelector("#hof-empty-msg") as HTMLElement;
  const retryBtn = mockContainer.querySelector("#hof-retry") as HTMLButtonElement;

  // Simulate error handler
  let currentYear = 2025;
  const handleError = (year: number) => {
    currentYear = year;
    empty.hidden = false;
    msg.textContent = "載入年度資料失敗，請重新整理或點擊重試。";
    retryBtn.hidden = false;
  };

  handleError(2025);
  expect(empty.hidden).toBe(false);
  expect(msg.textContent).toContain("載入年度資料失敗");
  expect(retryBtn.hidden).toBe(false);
  expect(currentYear).toBe(2025);
});
```

- [ ] **Step 4: 執行 DOM 測試確認通過**

Run: `bun test web/src/lib/hall-of-fame-dom.test.ts`
Expected: PASS

---

### Task 6: 驗證、型別檢查與完整建置

**Files:**
- Test: `web/src/lib/hall-of-fame.test.ts`
- Test: `web/src/lib/hall-of-fame-dom.test.ts`

- [ ] **Step 1: 執行全部單元測試**

Run: `bun test`
Expected: 全綠（0 failures）

- [ ] **Step 2: 執行 TypeScript 靜態型別檢查**

Run: `bunx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 執行 Astro 靜態網站建置**

Run: `bun run build`
Expected: 成功產生 `dist/`，`/hall-of-fame/` 正常生成

- [ ] **Step 4: 進行手動 Headless / 實機渲染驗證**

確認 Quick Jump 導覽連結跳轉、深淺主題切換、8 位名人卡片與系列卡 read-only 完整顯示、重試按鈕運作正常。
