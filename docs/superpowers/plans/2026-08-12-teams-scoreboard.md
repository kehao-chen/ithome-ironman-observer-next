# 團隊計分板（Team Scoreboard）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「團隊計分板」視圖——把 iThome 鐵人賽的組團現象當作參賽單位呈現（總瀏覽/人均/平均進度/今日發文），並標示落後警示（今日缺發/停更/未開賽），與既有組別/收藏分頁同級。

**Architecture:** 純 client-side。新增 `web/src/lib/teams.ts`（聚合純函式）+ `web/src/lib/teams-dom.ts`（DOM 建構，happy-dom 可測），Dashboard.astro 加「團隊計分板」filter chip + `#teams-board` 容器 + `view` 狀態切換。警示判定與主卡片共用 `daily-status.ts` 的 `statusChip`（零第二套邏輯）。

**Tech Stack:** Astro 5（Dashboard.astro）+ TypeScript（strict）+ Bun test（`bun:test`）+ happy-dom（DOM 契約測試）。無新依賴。

## Global Constraints

- 零後端、零 runtime 依賴、純 client-side 聚合（`data/*.json` 已是 DB）。
- `team` 欄位已在抓（`scripts/types.ts` Series.team），**scraper 零變動**、`data/` shape 零變動。
- 警示判定與主卡片**共用** `daily-status.ts` 的 `statusChip`/`stalenessDays`/`taipeiDay`——不另寫第二套。
- 禁止 `innerHTML` 放使用者資料（一律 `textContent`；DOM 建構用 `document.createElement`，同 `card-dom.ts`）。
- `today`（臺北日）由呼叫端傳入（SSR build 時點 / client runtime），不內部呼叫 `taipeiToday()`。
- 排序函式回傳副本，不 mutate 輸入（同 `sortSeries` 模式）。
- 數字一律 `tabular-nums`；字型用 `--font-sans`（mono 家族）。
- 語系：繁體中文 only。文件字串用繁體中文註解（專案慣例）。
- `activeGroupFor` 需擴充認識 `team:` 前綴；既有測試保持綠。
- 檔案路徑：`web/src/lib/*.ts`、`web/src/components/Dashboard.astro`、`web/src/styles/design-system.css`。

---

### Task 1: `teams.ts` 純函式資料層（聚合 + 警示 + 排序）

**Files:**
- Create: `web/src/lib/teams.ts`
- Test: `web/src/lib/teams.test.ts`

**Interfaces:**
- Consumes: `web/src/lib/daily-status.ts`（`statusChip`、`stalenessDays`、`StatusChip`、`taipeiDay`）、`web/src/lib/card.ts`（`totalViewsOf`、`ViewSeries`）、`scripts/types.ts`（`YearData`）
- Produces:
  ```ts
  export type TeamMemberRow = { series: ViewSeries; views: number; status: StatusChip; staleDays: number | null; isPending: boolean };
  export type TeamRow = { name: string; members: TeamMemberRow[]; memberCount: number; totalViews: number; avgViews: number; avgProgress: number; postedToday: number; staleCount: number; pendingCount: number; alertSummary: string | null; hasAlert: boolean };
  export type TeamSortKey = "totalViews" | "avgViews" | "avgProgress" | "postedToday";
  export function aggregateTeams(data: YearData, today: string): TeamRow[];
  export function teamNames(data: YearData): string[];
  export function sortTeamRows(rows: TeamRow[], key: TeamSortKey): TeamRow[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/teams.test.ts
import { describe, expect, test } from "bun:test";
import { aggregateTeams, sortTeamRows, teamNames, type TeamRow } from "./teams";
import type { Article, Series, YearData } from "../../../scripts/types";

function makeArticle(partial: Partial<Article> & { publishedAt: string; views: number }): Article {
  return { id: 1, day: 1, title: "t", url: "https://example.com", likes: 0, comments: 0, ...partial };
}
function makeSeries(partial: Partial<Series>): Series {
  const base: Series = {
    id: 1, user: { id: 1, name: "u", profileUrl: "https://ithelp.ithome.com.tw/users/1" },
    group: "Modern Web", title: "t", description: "", team: null,
    signupDate: "2026-01-01T00:00:00+08:00", lastUpdated: null,
    dayCount: 5, articleCount: 5, subscriptions: 3, articles: [],
  };
  return { ...base, ...partial };
}
function makeYear(series: Series[]): YearData {
  return { year: 2026, updatedAt: "2026-08-11T23:34:36+08:00", groups: ["Modern Web"], series, scrapeLog: [] };
}

const TODAY = "2026-08-11";

describe("aggregateTeams", () => {
  test("空 series / 無 team → []", () => {
    expect(aggregateTeams(makeYear([]), TODAY)).toEqual([]);
    expect(aggregateTeams(makeYear([makeSeries({})]), TODAY)).toEqual([]);
  });

  test("聚合數值：總瀏覽 / 人均 / 平均進度 / 今日發文數 / 成員數", () => {
    const year = makeYear([
      makeSeries({ id: 1, team: "T", dayCount: 10, articles: [makeArticle({ publishedAt: "2026-08-11T10:00:00+08:00", views: 100 })] }), // 今日 → postedToday
      makeSeries({ id: 2, team: "T", dayCount: 6, articles: [makeArticle({ publishedAt: "2026-08-10T10:00:00+08:00", views: 200 })] }), // 昨日 → 今日缺發
    ]);
    const [row] = aggregateTeams(year, TODAY);
    expect(row.name).toBe("T");
    expect(row.memberCount).toBe(2);
    expect(row.totalViews).toBe(300);
    expect(row.avgViews).toBe(150);
    expect(row.avgProgress).toBe(8);
    expect(row.postedToday).toBe(1); // 只有 id 1 是今日（spec §1.1「今日發文成員數」）
    expect(row.hasAlert).toBe(true); // id 2 昨日有發、今日未發 → 今日缺發
  });

  test("平均進度 cap 30（完賽成員不爆表）", () => {
    const year = makeYear([
      makeSeries({ id: 1, team: "T", dayCount: 30, articles: [] }),
      makeSeries({ id: 2, team: "T", dayCount: 30, articles: [] }),
    ]);
    expect(aggregateTeams(year, TODAY)[0].avgProgress).toBe(30);
  });

  test("警示分類互斥：昨日=今日缺發、≥2=停更、day0=未開賽", () => {
    const year = makeYear([
      makeSeries({ id: 1, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "2026-08-10T10:00:00+08:00", views: 1 })] }), // staleDays 1 → 今日缺發
      makeSeries({ id: 2, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "2026-08-08T10:00:00+08:00", views: 1 })] }), // staleDays 3 → 停更
      makeSeries({ id: 3, team: "T", dayCount: 0, articles: [] }), // 未開賽
      makeSeries({ id: 4, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "2026-08-11T10:00:00+08:00", views: 1 })] }), // 今日 → postedToday
    ]);
    const [row] = aggregateTeams(year, TODAY);
    expect(row.postedToday).toBe(1); // id 4
    expect(row.staleCount).toBe(1);
    expect(row.pendingCount).toBe(1);
    // 互斥：今日缺發 1（id 1）+ 停更 1（id 2）+ 未開賽 1（id 3）不重疊
    expect(row.alertSummary).toBe("今日缺發 1 人 · 停更 1 人 · 未開賽 1 人");
  });

  test("alertSummary 組裝：全健康 null；僅未開賽", () => {
    const healthy = makeYear([makeSeries({ id: 1, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "2026-08-11T10:00:00+08:00", views: 1 })] })]);
    expect(aggregateTeams(healthy, TODAY)[0].alertSummary).toBeNull();
    const pendingOnly = makeYear([
      makeSeries({ id: 1, team: "T", dayCount: 0, articles: [] }),
      makeSeries({ id: 2, team: "T", dayCount: 0, articles: [] }),
    ]);
    expect(aggregateTeams(pendingOnly, TODAY)[0].alertSummary).toBe("未開賽 2 人");
  });

  test("缺陷日期不判定；已刪文不計入警示", () => {
    const year = makeYear([
      makeSeries({ id: 1, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "garbage", views: 1 })] }), // 缺陷 → 不算缺發/今日
      makeSeries({ id: 2, team: "T", dayCount: 3, articleCount: 0, articles: [] }), // 已刪文（day>0 且 0 篇）→ 不算
    ]);
    const [row] = aggregateTeams(year, TODAY);
    expect(row.postedToday).toBe(0);
    expect(row.staleCount).toBe(0);
    expect(row.pendingCount).toBe(0);
    expect(row.alertSummary).toBeNull();
  });

  test("compact 輸入（sumViews + 單篇 latest）與完整輸入聚合一致", () => {
    const full = makeYear([
      makeSeries({ id: 1, team: "T", dayCount: 5, articles: [
        makeArticle({ publishedAt: "2026-08-10T10:00:00+08:00", views: 30 }),
        makeArticle({ publishedAt: "2026-08-11T10:00:00+08:00", views: 70 }),
      ] }),
    ]);
    const compact = makeYear([
      { ...makeSeries({ id: 1, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "2026-08-11T10:00:00+08:00", views: 70 })] }),
        sumViews: 100 } as Series & { sumViews?: number },
    ]);
    const a = aggregateTeams(full, TODAY)[0];
    const b = aggregateTeams(compact, TODAY)[0];
    expect(b.totalViews).toBe(a.totalViews); // 100
    expect(b.postedToday).toBe(a.postedToday); // 1（只看 latest）
  });

  test("真實資料 sweep：6 隊、20 成員、數值與手算一致", async () => {
    const real = (await Bun.file("../../data/2026.json").json()) as YearData;
    const rows = aggregateTeams(real, TODAY);
    expect(rows).toHaveLength(6);
    expect(rows.reduce((n, r) => n + r.memberCount, 0)).toBe(20);
    const top = rows[0]; // 總瀏覽 desc 主排序預設
    expect(top.name).toBe("五人成行，Bug 不行");
    expect(top.totalViews).toBe(4263);
    expect(top.avgViews).toBe(Math.floor(4263 / 5));
    expect(top.avgProgress).toBeCloseTo(9.8, 1);
    // postedToday = 今日發文成員數（spec §1.1）：五人成行 4 位今日發文（andy0317 昨日）、1 位昨日缺發 → 4
    expect(top.postedToday).toBe(4);
    expect(top.staleCount).toBe(0);
    expect(top.alertSummary).toContain("今日缺發 1 人");
  });
});

describe("teamNames", () => {
  test("回傳去重團隊名", () => {
    const year = makeYear([
      makeSeries({ id: 1, team: "T" }), makeSeries({ id: 2, team: "T" }), makeSeries({ id: 3, team: "U" }),
    ]);
    expect(teamNames(year)).toEqual(["T", "U"]);
  });
  test("無 team → []", () => {
    expect(teamNames(makeYear([makeSeries({})]))).toEqual([]);
  });
});

describe("sortTeamRows", () => {
  function row(name: string, totalViews: number, avgViews: number, avgProgress: number, postedToday: number): TeamRow {
    return { name, members: [], memberCount: 1, totalViews, avgViews, avgProgress, postedToday, staleCount: 0, pendingCount: 0, alertSummary: null, hasAlert: false };
  }
  test("四鍵排序 + 平手 tie（隊名 zh-Hant）", () => {
    const rows = [row("乙", 100, 10, 5, 2), row("甲", 200, 20, 9, 1), row("丙", 100, 15, 7, 3)];
    expect(sortTeamRows(rows, "totalViews").map((r) => r.name)).toEqual(["甲", "乙", "丙"]);
    expect(sortTeamRows(rows, "avgViews").map((r) => r.name)).toEqual(["甲", "丙", "乙"]);
    expect(sortTeamRows(rows, "avgProgress").map((r) => r.name)).toEqual(["甲", "丙", "乙"]);
    expect(sortTeamRows(rows, "postedToday").map((r) => r.name)).toEqual(["丙", "乙", "甲"]);
  });
  test("不 mutate 輸入", () => {
    const rows = [row("乙", 100, 1, 1, 1), row("甲", 200, 1, 1, 1)];
    const copy = [...rows];
    sortTeamRows(rows, "totalViews");
    expect(rows).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test src/lib/teams.test.ts`
Expected: FAIL（`Cannot find module "./teams"` 或 `aggregateTeams is not a function`）。

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/teams.ts
// 團隊計分板資料層：把 iThome 鐵人賽的組團現象聚合為參賽單位（純函式、無 DOM、可單元測試）。
// 警示判定與主卡片共用 daily-status.ts 的 statusChip / stalenessDays——無第二套邏輯。
import { stalenessDays, statusChip, type StatusChip } from "./daily-status";
import { totalViewsOf, type ViewSeries } from "./card";
import type { YearData } from "../../../scripts/types";

export type TeamMemberRow = {
  series: ViewSeries;
  views: number;            // 成員總瀏覽（totalViewsOf 語意）
  status: StatusChip;       // 既有 daily-status 判定（今日/昨日/停更/長時間停更/已刪文/完賽/尚未開賽）
  staleDays: number | null; // 停更天數（stalenessDays：null = 無文章或缺陷日期 → 不落入警示類別）
  isPending: boolean;       // dayCount === 0（尚未開賽）
};

export type TeamRow = {
  name: string;
  members: TeamMemberRow[];
  memberCount: number;
  totalViews: number;
  avgViews: number;         // 總瀏覽 ÷ 人數
  avgProgress: number;      // 成員 dayCount 平均（cap 30）
  postedToday: number;      // 今日發文成員數
  staleCount: number;       // 停更（≥2 天）成員數
  pendingCount: number;     // 未開賽成員數
  alertSummary: string | null; // 警示摘要（全健康 = null）
  hasAlert: boolean;        // alertSummary !== null
};

export type TeamSortKey = "totalViews" | "avgViews" | "avgProgress" | "postedToday";

export function teamNames(data: YearData): string[] {
  const seen = new Set<string>();
  for (const s of data.series) if (s.team) seen.add(s.team);
  return [...seen];
}

export function aggregateTeams(data: YearData, today: string): TeamRow[] {
  const byName = new Map<string, TeamMemberRow[]>();
  for (const s of data.series) {
    if (!s.team) continue;
    const members = byName.get(s.team) ?? [];
    const latest = s.articles.length ? s.articles[s.articles.length - 1] : null;
    members.push({
      series: s,
      views: totalViewsOf(s),
      status: statusChip(latest?.publishedAt, s.dayCount, today, s.articleCount),
      staleDays: stalenessDays(latest?.publishedAt, today),
      isPending: s.dayCount === 0, // 已刪文（dayCount>0 且 0 篇）天然排除
    });
    byName.set(s.team, members);
  }
  const rows: TeamRow[] = [];
  for (const [name, members] of byName) {
    const memberCount = members.length;
    const totalViews = members.reduce((n, m) => n + m.views, 0);
    let postedToday = 0, staleCount = 0, pendingCount = 0, missedToday = 0;
    // 警示分類互斥（spec §1.3）：未開賽 → 停更（≥2 天）→ 今日缺發（staleDays === 1，昨日有發今日未發）。
    // postedToday（spec §1.1「今日發文成員數」）= staleDays === 0 的成員；今日缺發獨立計數（missedToday）。
    // 任一成員只落入一類。
    for (const m of members) {
      if (m.isPending) { pendingCount++; continue; }
      if (m.staleDays !== null && m.staleDays >= 2) { staleCount++; continue; }
      if (m.staleDays === 0) postedToday++;
      else if (m.staleDays === 1) missedToday++;
    }
    const parts: string[] = [];
    if (missedToday > 0) parts.push(`今日缺發 ${missedToday} 人`);
    if (staleCount > 0) parts.push(`停更 ${staleCount} 人`);
    if (pendingCount > 0) parts.push(`未開賽 ${pendingCount} 人`);
    const alertSummary = parts.length > 0 ? parts.join(" · ") : null;
    rows.push({
      name, members, memberCount,
      totalViews,
      avgViews: totalViews / memberCount,
      avgProgress: members.reduce((n, m) => n + Math.min(m.series.dayCount, 30), 0) / memberCount,
      postedToday, staleCount, pendingCount,
      alertSummary,
      hasAlert: alertSummary !== null,
    });
  }
  return sortTeamRows(rows, "totalViews");
}

export function sortTeamRows(rows: TeamRow[], key: TeamSortKey): TeamRow[] {
  return [...rows].sort((a, b) => {
    const d = b[key] - a[key]; // desc（四鍵皆為數字）
    if (d !== 0) return d;
    return a.name.localeCompare(b.name, "zh-Hant"); // 平手 → 隊名穩定序
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test src/lib/teams.test.ts`
Expected: PASS（含真實資料 sweep——`data/2026.json` 6 隊、20 成員、`五人成行，Bug 不行` 總瀏覽 4263）。

- [ ] **Step 5: Commit**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git add web/src/lib/teams.ts web/src/lib/teams.test.ts
git commit -m "feat: teams aggregate pure functions"
```

---

### Task 2: `teams-dom.ts` 榜單列 DOM 建構（happy-dom 契約測試）

**Files:**
- Create: `web/src/lib/teams-dom.ts`
- Create: `web/src/lib/teams-dom.test.ts`

**Interfaces:**
- Consumes: `web/src/lib/teams.ts`（`TeamRow`、`TeamMemberRow`、`TeamSortKey`）、`web/src/lib/daily-status.ts`（`statusChipText`）、`web/src/lib/card-dom.ts`（`buildChip`）
- Produces:
  ```ts
  export function buildTeamRow(row: TeamRow, today: string): HTMLElement;
  // 回傳 <article class="team-row">，含：展開 toggle（data-expand，aria-expanded="false"）、
  // 團隊名、成員數、總瀏覽、人均、平均進度、今日發文、警示摘要（.team-alert）、
  // 展開成員區（hidden，含每位成員列 +「看該隊系列」按鈕 data-team-name）。
  ```

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/teams-dom.test.ts
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { buildTeamRow } from "./teams-dom";
import { statusChipText } from "./daily-status";
import type { TeamRow } from "./teams";

const win = new Window();
(globalThis as Record<string, unknown>).document = win.document;

const TODAY = "2026-08-11";

function makeRow(partial: Partial<TeamRow> = {}): TeamRow {
  return {
    name: "五人成行，Bug 不行", members: [
      { series: {} as never, views: 832, status: { kind: "today" }, staleDays: 0, isPending: false },
      { series: {} as never, views: 1059, status: { kind: "stale", days: 3 }, staleDays: 3, isPending: false },
    ],
    memberCount: 2, totalViews: 1891, avgViews: 945, avgProgress: 9, postedToday: 1, staleCount: 1, pendingCount: 0,
    alertSummary: "今日缺發 1 人 · 停更 1 人", hasAlert: true, ...partial,
  };
}

describe("buildTeamRow", () => {
  test("骨架：團隊名 + 成員數 + 四欄位 + 警示摘要 + 警示色 class", () => {
    const el = buildTeamRow(makeRow(), TODAY);
    expect(el.className).toBe("team-row");
    expect(el.dataset.teamName).toBe("五人成行，Bug 不行");
    expect(el.classList.contains("team-row--alert")).toBe(true);
    const text = el.textContent ?? "";
    expect(text).toContain("五人成行，Bug 不行");
    expect(text).toContain("2");          // 成員數
    expect(text).toContain("1,891");      // 總瀏覽 toLocaleString
    expect(text).toContain("945");        // 人均
    expect(text).toContain("9");          // 平均進度
    expect(text).toContain("1/2");        // 今日發文
    expect(text).toContain("今日缺發 1 人 · 停更 1 人");
  });
  test("健康列不加警示色、無摘要", () => {
    const el = buildTeamRow(makeRow({ alertSummary: null, hasAlert: false }), TODAY);
    expect(el.classList.contains("team-row--alert")).toBe(false);
    expect(el.textContent).not.toContain("停更");
  });
  test("展開區初始 hidden、含成員列與看該隊系列", () => {
    const el = buildTeamRow(makeRow(), TODAY);
    const body = el.querySelector<HTMLElement>(".team-body");
    expect(body).not.toBeNull();
    expect(body?.hidden).toBe(true);
    const memberRows = el.querySelectorAll(".team-member");
    expect(memberRows).toHaveLength(2);
    // 每位成員列：作者 + 狀態 chip（textContent 由 statusChipText 決定）
    expect(el.textContent).toContain(statusChipText({ kind: "today" }));
    expect(el.textContent).toContain(statusChipText({ kind: "stale", days: 3 }));
    const goBtn = el.querySelector<HTMLElement>("[data-team-name]");
    expect(goBtn?.textContent).toContain("看該隊系列");
    expect(goBtn?.dataset.teamName).toBe("五人成行，Bug 不行");
  });
  test("展開 toggle：aria-expanded 初始 false", () => {
    const el = buildTeamRow(makeRow(), TODAY);
    const toggle = el.querySelector<HTMLElement>("[data-expand]");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test src/lib/teams-dom.test.ts`
Expected: FAIL（`Cannot find module "./teams-dom"`）。

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/teams-dom.ts
// 團隊計分板榜單列 DOM 建構（client 專用，happy-dom 可測）。
// 顯示決定（警示摘要文字、狀態 chip）來自 teams.ts / daily-status.ts——此處只做骨架。
// 成員狀態 chip 直接複用 card-dom.ts 的 buildChip（view-model 產生 class/text/title）。
import { statusChipText } from "./daily-status";
import type { TeamRow } from "./teams";
import { cardViewModel } from "./card";
import { buildChip } from "./card-dom";

// Trusted static SVG icons（同 card-dom.ts 模式：無 innerHTML、屬性 mirror）。
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag: string, attrs: Record<string, string>, children: SVGElement[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}
function chevronIcon(): SVGElement {
  return svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M6 9l6 6 6-6" }),
  ]);
}

// 成員列：作者 + 組別 + DAY n/30 + 瀏覽 + 狀態 chip（buildChip 複用 view-model 判定）。
function buildMemberRow(m: TeamMemberRow, today: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "team-member";
  const v = cardViewModel(m.series, today);
  const name = document.createElement("a");
  name.className = "team-member-name";
  name.href = v.profileUrl;
  name.target = "_blank"; name.rel = "noopener";
  name.textContent = m.series.user?.name ?? "";
  const meta = document.createElement("span");
  meta.className = "team-member-meta";
  meta.textContent = `${m.series.group ?? ""} · ${v.progressLabel}`;
  const views = document.createElement("span");
  views.className = "team-member-views tabular-nums";
  views.textContent = `${m.views.toLocaleString()} 瀏覽`;
  const chip = buildChip(v);
  row.append(name, meta, views);
  if (chip) row.append(chip);
  return row;
}

export function buildTeamRow(row: TeamRow, today: string): HTMLElement {
  const el = document.createElement("article");
  el.className = "team-row";
  if (row.hasAlert) el.classList.add("team-row--alert");
  el.dataset.teamName = row.name;

  // 列頭：展開 toggle + 團隊名 + 計數
  const head = document.createElement("div");
  head.className = "team-row-head";
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.className = "team-expand";
  toggle.dataset.expand = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", `展開 ${row.name} 成員`);
  toggle.title = "展開成員";
  toggle.appendChild(chevronIcon());
  const name = document.createElement("span");
  name.className = "team-name"; name.textContent = row.name;
  const stats = document.createElement("div");
  stats.className = "team-stats";
  const stat = (label: string, value: string) => {
    const s = document.createElement("span");
    s.className = "team-stat";
    const v = document.createElement("span"); v.className = "tabular-nums"; v.textContent = value;
    const l = document.createElement("span"); l.className = "team-stat-label"; l.textContent = label;
    s.append(v, l);
    return s;
  };
  stats.append(
    stat("成員", String(row.memberCount)),
    stat("總瀏覽", row.totalViews.toLocaleString()),
    stat("人均", row.avgViews.toLocaleString()),
    stat("進度", `${row.avgProgress.toFixed(1)}/30`),
    stat("今日", `${row.postedToday}/${row.memberCount}`),
  );
  head.append(toggle, name, stats);
  if (row.alertSummary) {
    const alert = document.createElement("span");
    alert.className = "team-alert"; alert.textContent = row.alertSummary;
    head.append(alert);
  }

  // 展開區：成員清單 + 看該隊系列
  const body = document.createElement("div");
  body.className = "team-body"; body.hidden = true;
  for (const m of row.members) body.appendChild(buildMemberRow(m, today));
  const go = document.createElement("button");
  go.type = "button"; go.className = "team-go";
  go.dataset.teamName = row.name;
  go.textContent = "看該隊系列 →";
  body.appendChild(go);

  el.append(head, body);
  return el;
}
```

> 注意：`buildMemberRow` 的 `m` 參數型別是 `TeamMemberRow`——需在 import 型別時一併帶入（`import type { TeamMemberRow, TeamRow } from "./teams"`）。成員狀態 chip 由 `cardViewModel` + `buildChip` 產生（非手寫 chip class 分支）——與主卡片同一判定，且測試斷言 `statusChipText({ kind: "stale", days: 3 })` 的文字（「停更中」）出現在 member 列。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test src/lib/teams-dom.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git add web/src/lib/teams-dom.ts web/src/lib/teams-dom.test.ts
git commit -m "feat: teams board row DOM builder"
```

---

### Task 3: `filter.ts` 擴充 `team:` 前綴組別過濾 + `activeGroupFor` fallback

**Files:**
- Modify: `web/src/lib/filter.ts`
- Modify: `web/src/lib/filter.test.ts`

**Interfaces:**
- Consumes: 既有 `filter.ts`（`applySeriesFilters`、`activeGroupFor`、`SeriesFilterOptions`）
- Produces: 不變——`applySeriesFilters` 的 `group` 選項擴充接受 `team:<名稱>`；`activeGroupFor(groups, requested)` 認識 `team:` 前綴（回傳 requested 若該隊存在，否則 `"全部"`）。既有呼叫端（`Dashboard.astro`）不需改簽名。

- [ ] **Step 1: Write the failing test**

在 `web/src/lib/filter.test.ts` 的既有 `describe` 區塊內新增兩個 test（找到 `applySeriesFilters` 的 group filter describe，加入）：

```ts
describe("team: 前綴組別過濾", () => {
  test("team:名稱 → 只列出該隊成員系列", () => {
    const s1 = makeSeries({ id: 1, team: "五人成行，Bug 不行", title: "A" });
    const s2 = makeSeries({ id: 2, team: "五人成行，Bug 不行", title: "B" });
    const s3 = makeSeries({ id: 3, team: "不買股票買機票", title: "C" });
    const data = { year: 2026, updatedAt: "2026-08-11T10:00:00+08:00", groups: ["Modern Web"], series: [s1, s2, s3], scrapeLog: [] };
    const out = applySeriesFilters(data, { group: "team:五人成行，Bug 不行", sort: "dayCount", query: "", favSet: new Set() });
    expect(out.map((s) => s.id)).toEqual([1, 2]);
  });
  test("team: 與搜尋交集", () => {
    const s1 = makeSeries({ id: 1, team: "T", title: "React 教學" });
    const s2 = makeSeries({ id: 2, team: "T", title: "Vue 教學" });
    const data = { year: 2026, updatedAt: "2026-08-11T10:00:00+08:00", groups: ["Modern Web"], series: [s1, s2], scrapeLog: [] };
    const out = applySeriesFilters(data, { group: "team:T", sort: "dayCount", query: "vue", favSet: new Set() });
    expect(out.map((s) => s.id)).toEqual([2]);
  });
});

describe("activeGroupFor 認識 team: 前綴", () => {
  test("存在 → 保留；不存在 → fallback 全部", () => {
    expect(activeGroupFor(["全部", "Modern Web"], "team:五人成行，Bug 不行", ["五人成行，Bug 不行"])).toBe("team:五人成行，Bug 不行");
    expect(activeGroupFor(["全部", "Modern Web"], "team:不存在的隊", ["五人成行，Bug 不行"])).toBe("全部");
    // 不傳 teamNames（既有呼叫）→ team: 前綴視為不存在 → fallback 全部（語意不變）
    expect(activeGroupFor(["全部", "Modern Web"], "team:五人成行，Bug 不行")).toBe("全部");
  });
  test("fav 與普通組別語意不變", () => {
    expect(activeGroupFor(["全部", "Modern Web"], "fav")).toBe("fav");
    expect(activeGroupFor(["全部", "Modern Web"], "Modern Web")).toBe("Modern Web");
    expect(activeGroupFor(["全部", "Modern Web"], "Missing")).toBe("全部");
  });
});
```

> 注意：`activeGroupFor` 簽名是 `(groups: string[], requested: string)`——`groups` 是 UI 的組別選項陣列（「全部」+ 組別名），**不含團隊名**。要支援 `team:` 檢查存在性，`activeGroupFor` 需要第三個參數（團隊名陣列）或改由 `Dashboard.astro` 在呼叫前先檢查 `teamNames(data)`。**建議**：新增 `activeGroupFor(groups, requested, teamNames)`（第三參數選填，向後相容既有呼叫）——`requested` 以 `team:` 前綴時，若 `teamNames` 含該名稱 → 保留，否則 `"全部"`。既有呼叫（`activeGroupFor(groups, currentGroup())`）不傳第三參數 → 語意不變（`team:` 只在有第三參數時才被認識；Dashboard 呼叫處在 Task 5 補傳）。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test src/lib/filter.test.ts`
Expected: FAIL（`team:` 不命中、`activeGroupFor` 對 `team:` 回傳 `"全部"`）。

- [ ] **Step 3: Write minimal implementation**

在 `web/src/lib/filter.ts`：

```ts
// activeGroupFor：年度切換時 resolve active。fav 恆保留；普通組別在新年度不存在 → fallback「全部」。
// team: 前綴（計分板「看該隊系列」chip）——需要 teamNames 參數檢查該隊是否仍在；不傳（既有呼叫）→ 語意不變（team: 視為不存在 → 全部）。
export function activeGroupFor(groups: string[], requested: string, teamNames?: string[]): string {
  if (requested === "fav") return "fav";
  if (requested.startsWith("team:")) {
    const t = requested.slice(5);
    return teamNames?.includes(t) ? requested : "全部";
  }
  return groups.includes(requested) ? requested : "全部";
}
```

在 `applySeriesFilters` 的組別 filter 分支：

```ts
} else if (opts.group.startsWith("team:")) {
  const t = opts.group.slice(5);
  series = series.filter((s) => s.team === t); // 團隊系列流：該隊成員子集
} else if (opts.group !== "全部") {
  series = series.filter((s) => s.group === opts.group);
}
```

> 若 `filter.test.ts` 的 `applySeriesFilters` 對 `group` 只做 `!== "全部"` 的組別相等比對（現況），`team:` 會落入 `s.group === "team:…"` 永遠不命中——新分支必須在既有 `else if (opts.group !== "全部")` **之前**。既有測試（普通組別）不受影響。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test src/lib/filter.test.ts`
Expected: PASS（既有 + 新增）。

- [ ] **Step 5: Commit**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git add web/src/lib/filter.ts web/src/lib/filter.test.ts
git commit -m "feat: filter team: prefix group"
```

---

### Task 4: Dashboard.astro SSR——計分板 chip、`#teams-board` 容器、計數

**Files:**
- Modify: `web/src/components/Dashboard.astro`

**Interfaces:**
- Consumes: `web/src/lib/teams.ts`（`teamNames`）
- Produces: SSR 靜態結構——filter 列最前方「團隊計分板」chip（`data-group="teams"`，計數 = `teamNames(data).length`）、`#teams-board` 容器（`hidden` 預設）放 `<main>` 內 `#series-list` 之後。後續 Task 5 的 client script 操作這些節點。

- [ ] **Step 1: 修改 frontmatter**

在 `web/src/components/Dashboard.astro` frontmatter（`import { isoInitial }` 之後）加 import 與計數：

```astro
import { teamNames } from "../lib/teams";
```

在 `const updatedAtFallback = isoInitial(data.updatedAt);` 之後：

```astro
const teamCount = teamNames(data).length;
```

- [ ] **Step 2: 修改 filter 列——「團隊計分板」chip 在「我的收藏」之前**

`<div class="filter-group" id="group-filters" role="group" aria-label="依組別篩選">` 內、「我的收藏」button 之前插入：

```html
<button data-group="teams" class="filter-btn" data-active="false">
  <span class="filter-label">團隊計分板</span>
  <span class="filter-count tabular-nums">{teamCount}</span>
</button>
```

- [ ] **Step 3: 修改 `<main>`——`#teams-board` 容器**

`<div class="series-grid" id="series-list">…</div>` 之後（`</main>` 之前）插入：

```html
<div class="teams-board" id="teams-board" hidden>
  <div class="teams-head" role="row">
    <span class="th th-expand" aria-hidden="true"></span>
    <button type="button" class="th th-sortable" data-sort="totalViews" aria-sort="descending">團隊</button>
    <span class="th">成員</span>
    <button type="button" class="th th-sortable" data-sort="totalViews" aria-sort="descending">總瀏覽</button>
    <button type="button" class="th th-sortable" data-sort="avgViews">人均</button>
    <button type="button" class="th th-sortable" data-sort="avgProgress">平均進度</button>
    <button type="button" class="th th-sortable" data-sort="postedToday">今日發文</button>
    <span class="th">警示</span>
  </div>
  <div id="teams-list"></div>
  <div class="teams-empty" id="teams-empty" role="status" aria-live="polite" hidden>
    <p>這個年度還沒有團隊報名</p>
  </div>
</div>
```

> `#teams-board` 是計分板視圖容器（SSR 靜態輸出、`hidden` 預設），`#teams-list` 由 client 填入榜單列，`#teams-empty` 空狀態。表頭 `data-sort` 為排序鍵；`aria-sort` 標示目前排序（初始 `totalViews` desc）。

- [ ] **Step 4: 驗證 SSR**

Run: `cd web && bun run build`
Expected: build 成功，無 TypeScript error。

- [ ] **Step 5: Commit**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git add web/src/components/Dashboard.astro
git commit -m "feat: teams board SSR shell"
```

---

### Task 5: Dashboard.astro client——視圖切換、計分板渲染、表頭排序、「看該隊系列」

**Files:**
- Modify: `web/src/components/Dashboard.astro`

**Interfaces:**
- Consumes: Task 1 `aggregateTeams`/`sortTeamRows`/`teamNames`、Task 2 `buildTeamRow`、Task 3 `activeGroupFor(…, teamNames)`、既有 `applyFilter`/`render`/`loadYear`/`taipeiToday`
- Produces: client 行為——`view` 狀態、`#teams-board` 顯示/隱藏、榜單渲染、表頭排序切換、`team:` chip 過濾、「看該隊系列」按鈕、計分板視圖下搜尋/排序/視圖切換器隱藏、年度切換重聚合與 `team:` fallback。

- [ ] **Step 1: 新增 import 與模組級 state**

在 `<script>` 頂部（`import { buildCard, buildRow } from "../lib/card-dom";` 之後）加：

```ts
import { aggregateTeams, sortTeamRows, teamNames, type TeamSortKey } from "../lib/teams";
import { buildTeamRow } from "../lib/teams-dom";
```

在 `let viewMode: "grid" | "list" = "grid";` 附近加：

```ts
let view: "series" | "teams" = "series"; // 主視圖 / 計分板視圖
let teamSortKey: TeamSortKey = "totalViews"; // 計分板排序鍵（視圖內狀態）
const teamsBoard = document.getElementById("teams-board");
const teamsList = document.getElementById("teams-list");
const teamsEmpty = document.getElementById("teams-empty");
const toolbarControls = document.querySelector(".toolbar-controls");
```

- [ ] **Step 2: 計分板視圖切換 helper**

```ts
function setTeamsView(on: boolean) {
  view = on ? "teams" : "series";
  list.hidden = on;
  if (teamsBoard) teamsBoard.hidden = !on;
  // 計分板視圖下隱藏搜尋/排序/視圖切換器（計分板有自己的表頭排序）；query 保留。
  if (toolbarControls) toolbarControls.hidden = on;
  const seg = document.querySelector(".header-actions .seg");
  if (seg) (seg as HTMLElement).hidden = on;
  if (on && current) renderTeams(current);
}
```

- [ ] **Step 3: 計分板渲染**

```ts
function renderTeams(data: ViewData) {
  if (!teamsList) return;
  const rows = sortTeamRows(aggregateTeams(data, today), teamSortKey);
  teamsList.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const r of rows) frag.appendChild(buildTeamRow(r, today));
  teamsList.appendChild(frag);
  if (teamsEmpty) teamsEmpty.hidden = rows.length > 0;
  // 表頭 aria-sort 更新：目前排序鍵的欄位標 descending，其餘清除。
  document.querySelectorAll<HTMLElement>(".th-sortable").forEach((th) => {
    if (th.dataset.sort === teamSortKey) th.setAttribute("aria-sort", "descending");
    else th.removeAttribute("aria-sort");
  });
}
```

- [ ] **Step 4: 接入 `applyFilter`——`teams` 與 `team:` 分支**

在 `applyFilter(data, group, sort)` 開頭（`applySeriesFilters` 呼叫之前）加：

```ts
if (group === "teams") {
  setTeamsView(true);
  return; // 計分板視圖不渲染系列流
}
setTeamsView(false);
```

在 `render(data)` 的年度切換區塊，`activeGroupFor` 呼叫改為傳 teamNames（第三參數）：

```ts
const active = activeGroupFor(groups, currentGroup(), teamNames(data));
```

> 既有呼叫（Task 5 之前）不傳第三參數 → 語意不變；此處改傳後 `team:` chip 新年份無此隊 → fallback「全部」（spec §2.5）。

> `applyFilter` 原本對 `team:` 前綴的處理走 `applySeriesFilters`（Task 3 已擴充）——此分支不需額外改動；但 **`isFavView()` 與 `totalCount` 分母**需確認：`totalCount.textContent = String(group === "fav" ? currentYearFavCount(data, favSet) : data.series.length)` 對 `team:` 會顯示年度總數（分母語意可接受，團隊系列流 = 該隊成員數，狀態列顯示該隊數即可——若要精確，改 `group.startsWith("team:") ? 成員數 : …`）。

- [ ] **Step 5: 表頭排序 + 展開 + 看該隊系列事件**

在 `/* ---------- Events ---------- */` 區塊內、`groupFilters?.addEventListener` 附近加：

```ts
// 表頭排序：點擊切換計分板排序鍵（視圖內狀態，不污染主排序器）。
document.querySelectorAll<HTMLElement>(".th-sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort as TeamSortKey;
    if (!key) return;
    teamSortKey = key;
    if (current && view === "teams") renderTeams(current);
  });
});

// 展開/收合 + 看該隊系列（事件委派在 #teams-board 上）。
teamsBoard?.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const expand = t.closest<HTMLElement>("[data-expand]");
  if (expand) {
    const row = expand.closest<HTMLElement>(".team-row");
    const body = row?.querySelector<HTMLElement>(".team-body");
    if (body) {
      const open = body.hidden;
      body.hidden = !open;
      expand.setAttribute("aria-expanded", String(open));
      expand.setAttribute("aria-label", open ? `收合 ${row!.dataset.teamName} 成員` : `展開 ${row!.dataset.teamName} 成員`);
    }
    return;
  }
  const go = t.closest<HTMLElement>("[data-team-name]");
  if (go) {
    // 看該隊系列：切回主視圖 + filter 設為該隊 + 套用主排序器。
    const group = `team:${go.dataset.teamName}`;
    groupFilters?.querySelectorAll(".filter-btn").forEach((b) => b.setAttribute("data-active", "false"));
    // 該隊 chip 可能不存在（計分板 chip 是 data-group="teams"）——動態建立。
    let btn = groupFilters?.querySelector<HTMLElement>(`.filter-btn[data-group="${CSS.escape(group)}"]`);
    if (!btn && groupFilters) {
      btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.dataset.group = group;
      const label = document.createElement("span");
      label.className = "filter-label";
      label.textContent = go.dataset.teamName ?? "";
      const cnt = document.createElement("span");
      cnt.className = "filter-count tabular-nums";
      cnt.textContent = "0";
      btn.append(label, cnt);
      groupFilters.appendChild(btn);
    }
    btn?.setAttribute("data-active", "true");
    if (current) applyFilter(current, group, (document.getElementById("sort") as HTMLSelectElement)?.value ?? "dayCount");
  }
});
```

- [ ] **Step 6: `render(data)` 與 60s refresh 接入計分板**

- `render(data)` 結尾：若 `view === "teams"`，`renderTeams(data)`（年度切換後重聚合）。放在 `applyFilter(data, group, sort); humanizeAll();` 之後：

```ts
if (view === "teams") renderTeams(data);
```

- `yearSelect` change handler 與 `loadYear` 不變（`render` 內已處理重聚合）。
- `today` 週期校正（現有 `setInterval`）不變——`renderTeams` 每次讀最新 `today`。

- [ ] **Step 7: 驗證**

- `cd web && bunx tsc --noEmit`（root：`cd /Users/kehao/projects/ithome-ironman-observer-next && bunx tsc --noEmit`）乾淨。
- `cd web && bun test`（全專案測試含新增）全綠。
- `cd web && bun run build` 成功。
- 手動 smoke（見 spec §5.4）：載入頁面 → 計分板 chip 出現、點擊切換、表頭排序、展開成員、看該隊系列、警示色、年度切換 fallback。

- [ ] **Step 8: Commit**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git add web/src/components/Dashboard.astro
git commit -m "feat: teams board view toggle and interactions"
```

---

### Task 6: `design-system.css`——計分板樣式

**Files:**
- Modify: `web/src/styles/design-system.css`

**Interfaces:**
- Consumes: Task 2 `teams-dom.ts` 的 class 名稱（`.team-row`、`.team-row--alert`、`.team-row-head`、`.team-expand`、`.team-name`、`.team-stats`、`.team-stat`、`.team-stat-label`、`.team-alert`、`.team-body`、`.team-member`、`.team-member-name`、`.team-member-meta`、`.team-member-views`、`.team-go`）+ Task 4 SSR 表頭（`.teams-board`、`.teams-head`、`.th`、`.th-sortable`、`#teams-empty`）

- [ ] **Step 1: 新增樣式（`design-system.css` 尾部、`.fav-empty` 區塊之後）**

```css
/* ---------- 團隊計分板 ---------- */
.teams-board {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.teams-board[hidden] { display: none; }

/* 表頭（SSR 靜態輸出） */
.teams-head {
  display: grid;
  grid-template-columns: 28px minmax(0, 1.4fr) 64px 96px 96px 96px 96px minmax(120px, 1fr);
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-sans);
  font-size: var(--text-2xs);
  color: var(--muted);
}
.th { font-weight: 600; }
.th-sortable {
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--muted);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
}
.th-sortable:hover { color: var(--text); text-decoration: none; }
.th-sortable[aria-sort] { color: var(--accent); }
.th-sortable[aria-sort]::after { content: " ↓"; } /* 目前排序鍵指示 */

/* 榜單列 */
.team-row {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.team-row--alert {
  border-inline-start: 3px solid var(--warning);
  background: color-mix(in srgb, var(--warning-weak) 30%, var(--surface));
}
.team-row-head {
  display: grid;
  grid-template-columns: 28px minmax(0, 1.4fr) auto;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
}
.team-expand {
  appearance: none;
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.team-expand:hover { color: var(--accent); background: var(--accent-weak); }
.team-expand svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; transition: transform 0.15s ease; }
.team-expand[aria-expanded="true"] svg { transform: rotate(90deg); }
.team-name { font-weight: 600; color: var(--text); }
.team-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: flex-end;
}
.team-stat { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.team-stat .tabular-nums { font-family: var(--font-sans); font-size: var(--text-sm); color: var(--text); }
.team-stat-label { font-family: var(--font-sans); font-size: var(--text-2xs); color: var(--muted); }
.team-alert {
  /* 列頭是 3 欄 grid（toggle/name/stats），.team-alert 是第 4 個 child——必須顯式放置，
     否則 grid-auto-flow: row 會把它丟到第二行、溢出第一欄 28px track（review 實渲染證實）。 */
  grid-column: 2 / -1;
  justify-self: end;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--badge-warning-text);
  background: var(--warning-weak);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

/* 展開成員區 */
.team-body {
  border-top: 1px solid var(--border);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.team-body[hidden] { display: none; }
.team-member {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}
.team-member:hover { background: color-mix(in srgb, var(--accent) 4%, var(--surface)); }
.team-member-name { color: var(--text); font-weight: 500; min-width: 0; }
.team-member-name:hover { color: var(--accent); text-decoration: none; }
.team-member-meta { font-family: var(--font-sans); font-size: var(--text-2xs); color: var(--muted); }
.team-member-views { font-family: var(--font-sans); font-size: var(--text-xs); color: var(--muted); margin-inline-start: auto; }
.team-go {
  appearance: none;
  align-self: flex-start;
  margin-top: var(--space-2);
  background: none;
  border: none;
  padding: var(--space-1) var(--space-2);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--accent);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.team-go:hover { background: var(--accent-weak); text-decoration: none; }

/* 空狀態 */
.teams-empty {
  text-align: center;
  padding: var(--space-6);
  color: var(--muted);
  font-size: var(--text-sm);
}
.teams-empty[hidden] { display: none; }

/* 計分板視圖下隱藏主視圖控制 */
.toolbar-controls[hidden],
.header-actions .seg[hidden] { display: none; }

/* 行動版：表頭與列頭改為捲動式（窄屏欄位塞不下） */
@media (max-width: 900px) {
  .teams-head { display: none; } /* 行動版隱藏表頭（欄位仍顯示在列上） */
  .team-row-head {
    grid-template-columns: 26px minmax(0, 1fr) auto;
  }
  .team-alert { grid-column: 1 / -1; justify-self: start; } /* 行動版警示摘要換到新行（整列寬） */
  .team-stats { justify-content: flex-start; }
}
```

- [ ] **Step 2: 驗證視覺**

`cd web && bun run dev`，瀏覽器載入 → 切到計分板視圖，確認：dark/light 兩主題下列頭/警示色/展開區可讀；窄視窗（<900px）表頭隱藏、欄位仍在列上。

- [ ] **Step 3: Commit**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git add web/src/styles/design-system.css
git commit -m "style: teams board styles"
```

---

### Task 7: 文件同步（README + PRODUCT.md）

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`

**Interfaces:**
- Consumes: 無（純文件）

- [ ] **Step 1: README Features**

`README.md` 的 Features 區塊加一行：`- 團隊計分板：把組團視為參賽單位，總瀏覽/人均/平均進度/今日發文 + 落後警示（今日缺發/停更/未開賽），可展開成員並跳轉該隊系列流`。

- [ ] **Step 2: PRODUCT.md roadmap**

`PRODUCT.md` roadmap 加候選並標記完成（與 search/favorites 完成項同格式）：

```markdown
- [x] **Team scoreboard**（完成 2026-08-12）：`web/src/lib/teams.ts` 純函式聚合 + Dashboard 計分板視圖（總瀏覽/人均/平均進度/今日發文 + 警示：今日缺發/停更≥2 天/未開賽，與 daily-status 共用判定）。
```

放在 roadmap「Mid-term candidates」區塊（search 完成項附近）。

- [ ] **Step 3: 驗證文件無損**

Run: `grep -n "團隊計分板" README.md PRODUCT.md`
Expected: 兩處皆命中（README Features + PRODUCT roadmap）。

- [ ] **Step 4: Commit**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git add README.md PRODUCT.md
git commit -m "docs: teams scoreboard feature docs"
```

---

### Task 8: 最終驗證（全量測試 + build + smoke）

**Files:**
- 無（驗證）

**Interfaces:**
- Consumes: 全部前序任務

- [ ] **Step 1: 全量測試**

Run: `cd /Users/kehao/projects/ithome-ironman-observer-next && bun test`
Expected: 全綠（既有 227 + 新增 teams/teams-dom/filter 測試）。

- [ ] **Step 2: 型別與 build**

Run: `cd /Users/kehao/projects/ithome-ironman-observer-next && bunx tsc --noEmit && cd web && bun run build`
Expected: tsc 乾淨、Astro build 成功、無 console error。

- [ ] **Step 3: 手動 smoke（headless browser 或 dev server）**

1. 載入首頁 → 計分板 chip 出現（filter 列最前方、計數 = 6）。
2. 點計分板 chip → 榜單出現（系列卡片隱藏、搜尋/排序/視圖切換器隱藏）；狀態列顯示團隊數。
3. 榜單排序：點「人均」表頭 → 排序切換、`aria-sort` 更新。
4. 展開「五人成行，Bug 不行」→ 5 位成員（作者/組別/DAY/瀏覽/狀態 chip）；「看該隊系列」→ 回到主視圖、filter = 該隊、套用主排序器。
5. 警示色：`五人成行`（今日缺發 1 人）與 `不買股票買機票`（未開賽 4 人）列有警告色；`這不薄冰哥嗎`（全健康）無色。
6. 年度切換：計分板視圖下換年 → 重聚合；`team:` chip 新年份無此隊 → fallback「全部」。
7. 搜尋 query 在計分板視圖與系列流間保留。
8. 無 console error。

- [ ] **Step 4: 最終 commit（若有殘留）**

```bash
cd /Users/kehao/projects/ithome-ironman-observer-next
git status --short
# 若有未 commit 變更：git add -A && git commit -m "chore: final polish"
```
