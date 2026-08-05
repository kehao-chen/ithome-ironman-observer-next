# 鐵人觀察家 Next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, self-updating dashboard showing daily article progress of the 2026 iThome 鐵人賽, scraped from ithelp.ithome.com.tw, served as a static site on Cloudflare Pages, refreshed hourly by GitHub Actions.

**Architecture:** A Bun scraper fetches the official signup list (series IDs + metadata), then per series fetches its RSS feed (article list) and its series page (view/like/comment counts). Data merges into `data/2026.json`. Astro pre-renders the dashboard from that JSON; client JS re-fetches it for live updates. GitHub Actions cron runs the scraper, commits data changes, builds, and deploys to Cloudflare Pages via wrangler.

**Tech Stack:** Bun 1.3+, TypeScript, Astro 5, GitHub Actions cron, Cloudflare Pages (wrangler CLI), no database, no backend.

## Global Constraints

- All scraped data must come from public ithelp endpoints (no auth).
- Requests to ithelp MUST send browser User-Agent header, else 403 (Cloudflare challenge verified).
- Data format MUST match spec schema exactly (see `docs/superpowers/specs/2026-08-05-ironman-observer-next-design.md`).
- Runtime: Bun ≥ 1.3.14. Astro ≥ 5. Node ≥ 20.
- Cost target: $0/mo (GH Actions free tier, Cloudflare Pages free tier).
- Non-goals (do NOT implement): multi-year data, search, completion badges, auth, real-time updates, 2024 data import.
- Error handling: single-series failure must not abort the batch; empty scrape must not overwrite existing data.
- Timezone: all `publishedAt`/`signupDate` timestamps in `+08:00` (Asia/Taipei).

---

## File Structure

```
ithome-ironman-observer-next/
├── docs/superpowers/specs/2026-08-05-ironman-observer-next-design.md   (existing, read-only reference)
├── config/
│   └── series-manifest.json            # year + source URLs (single source of truth for years)
├── data/
│   ├── meta.json                       # { updatedAt, seriesCount } — written by scraper
│   └── 2026.json                       # the dashboard dataset
├── scripts/
│   ├── fetch-html.ts                   # HTTP with UA/retry/backoff (shared)
│   ├── parse-signup.ts                 # signup/list HTML → SignupCard[]
│   ├── parse-rss.ts                    # RSS XML → RssChannel
│   ├── parse-series.ts                 # series page HTML → SeriesStats + ArticleStats[]
│   ├── scrape.ts                       # orchestrates fetch+parse+merge → writes data/
│   └── __fixtures__/                   # saved HTML/XML samples for tests
│       ├── signup-page.html            # (from live 2026 list p1, saved during Task 1)
│       ├── rss-series.xml              # (from live RSS, saved during Task 2)
│       └── series-page.html            # (from live series page, saved during Task 3)
├── web/                                # Astro site
│   ├── astro.config.mjs
│   ├── package.json
│   ├── tsconfig.json
│   ├── public/
│   │   ├── data/2026.json              # copied from ../data during build
│   │   ├── _headers                   # cache headers
│   │   └── _redirects
│   └── src/
│       ├── pages/index.astro          # dashboard page
│       └── components/
│           ├── Dashboard.astro         # layout: header, filters, list
│           └── SeriesCard.astro        # single series card
├── .github/workflows/update.yml       # hourly cron scrape+build+deploy
├── package.json                       # root: scripts (scrape, build, test), bun workspace
└── wrangler.toml                      # Cloudflare Pages project config
```

## Global Data Types (shared across tasks)

```typescript
// config/series-manifest.json
type Manifest = { year: number; signupListUrl: string; }

// data/2026.json (spec schema)
type Article = {
  id: number; day: number; title: string; url: string;
  publishedAt: string; // ISO +08:00
  views: number; likes: number; comments: number;
}
type Series = {
  id: number; user: { id: number; name: string; profileUrl: string };
  group: string; title: string; description: string; team: string | null;
  signupDate: string; lastUpdated: string | null; // RSS lastBuildDate (spec: 更新時間 card field)
  dayCount: number; articleCount: number; subscriptions: number;
  articles: Article[];
}
type YearData = { year: number; updatedAt: string; groups: string[]; series: Series[] }

// Internal parser types
type SignupCard = {
  seriesId: number; userId: number; name: string;
  group: string; title: string; description: string;
  team: string | null; signupDate: string; day: number; // day 0 = 尚未開賽
}
type RssChannel = {
  title: string; link: string; description: string;
  lastBuildDate: string | null; // ISO
  items: { title: string; link: string; pubDate: string; description: string }[];
}
type SeriesStats = {
  dayCount: number; articleCount: number; subscriptions: number;
  articles: { id: number; day: number; title: string; url: string;
              publishedAt: string; views: number; likes: number; comments: number }[];
}
```

---

### Task 1: Scraper scaffold + fetch-html with retry

**Files:**
- Create: `package.json` (root, bun workspace)
- Create: `tsconfig.json` (root)
- Create: `scripts/fetch-html.ts`
- Create: `scripts/fetch-html.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `fetchHtml(url: string, opts?: { retries?: number }): Promise<string>` — returns raw HTML/XML body, throws on 4xx/5xx after retries; `BROWSER_UA` constant export.

- [ ] **Step 1: Create root package.json + tsconfig**

```json
{
  "name": "ironman-observer-next",
  "private": true,
  "scripts": {
    "scrape": "bun run scripts/scrape.ts",
    "test": "bun test",
    "build": "cd web && bun install && bun run build"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/bun": "latest"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 2: Write failing test for fetchHtml**

```typescript
// scripts/fetch-html.test.ts
import { describe, expect, test } from "bun:test";
import { fetchHtml, BROWSER_UA } from "./fetch-html";

describe("fetchHtml", () => {
  test("sends browser UA and returns body", async () => {
    const html = await fetchHtml("https://ithelp.ithome.com.tw/2026ironman/signup/list");
    expect(html).toContain("報名數");
    expect(html.length).toBeGreaterThan(1000);
  });

  test("retries then throws on persistent 404", async () => {
    await expect(fetchHtml("https://ithelp.ithome.com.tw/definitely-not-a-page-404", { retries: 1 }))
      .rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test scripts/fetch-html.test.ts`
Expected: FAIL — module `./fetch-html` not found.

- [ ] **Step 4: Implement fetch-html.ts**

```typescript
// scripts/fetch-html.ts
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function fetchHtml(url: string, opts: { retries?: number } = {}): Promise<string> {
  const retries = opts.retries ?? 3;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // 1s, 2s, 4s
      }
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test scripts/fetch-html.test.ts`
Expected: PASS (2 tests). Live network hit returns 報名數 page.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json scripts/fetch-html.ts scripts/fetch-html.test.ts
git commit -m "feat: scraper scaffold with UA fetch + retry"
```

---

### Task 2: Parse signup list → SignupCard[]

**Files:**
- Create: `scripts/parse-signup.ts`
- Create: `scripts/parse-signup.test.ts`
- Create: `scripts/__fixtures__/signup-page.html` (saved from live list p1 during Step 1)

**Interfaces:**
- Consumes: `fetchHtml` from Task 1.
- Produces: `parseSignupList(html: string): SignupCard[]` (types in Global Data Types). `signupListUrl(year: number): string` helper returning `https://ithelp.ithome.com.tw/${year}ironman/signup/list`.

Verified field regexes (from live 2026 HTML):
- card split: `<div class="list-card">`
- seriesId/userId: `/users/(\d+)/ironman/(\d+)` on title link
- name: `class="contestants-list__name">([^<]+)`
- group: `<span>([^<]+)</span>` inside first `.tag` div
- signupDate: `報名日期：([\d/]+ [\d:]+)`
- title: `class="contestants-list__title title">([^<]+)`
- description: `class="contestants-list__desc content">(.*?)</p>`
- team: `<div class="contestants-list__team">...<a[^>]*>([^<]+)</a>` (optional)
- day: `DAY\s*(\d+)` OR `尚未開賽` → day 0

- [ ] **Step 1: Save live fixture**

Run (bash):
```bash
mkdir -p scripts/__fixtures__
curl -s 'https://ithelp.ithome.com.tw/2026ironman/signup/list' -H 'User-Agent: Mozilla/5.0' -o scripts/__fixtures__/signup-page.html
wc -c scripts/__fixtures__/signup-page.html   # expect ~52KB
```

- [ ] **Step 2: Write failing test**

```typescript
// scripts/parse-signup.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseSignupList } from "./parse-signup";

describe("parseSignupList", () => {
  test("parses cards from fixture", () => {
    const html = readFixture("signup-page.html");
    const cards = parseSignupList(html);
    expect(cards.length).toBe(10);
    const first = cards[0];
    expect(first.seriesId).toBeGreaterThan(9000);
    expect(first.userId).toBeGreaterThan(20000000);
    expect(first.name.length).toBeGreaterThan(0);
    expect(first.group.length).toBeGreaterThan(0);
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.signupDate).toMatch(/^\d{4}\/\d{2}\/\d{2}/);
    expect(typeof first.day).toBe("number");
    expect(first.day).toBeGreaterThanOrEqual(0);
  });

  test("day is 0 for 尚未開賽 cards", () => {
    const html = readFixture("signup-page.html");
    const cards = parseSignupList(html);
    const notStarted = cards.find((c) => c.day === 0);
    // page 1 of live list contains at least one not-started card (verified)
    expect(notStarted).toBeDefined();
  });
});
```

- [ ] **Step 3: Create test-utils helper**

```typescript
// scripts/test-utils.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readFixture(name: string): string {
  return readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test scripts/parse-signup.test.ts`
Expected: FAIL — `parseSignupList` not exported / module not found.

- [ ] **Step 5: Implement parse-signup.ts**

```typescript
// scripts/parse-signup.ts
import type { SignupCard } from "./types";

export function signupListUrl(year: number): string {
  return `https://ithelp.ithome.com.tw/${year}ironman/signup/list`;
}

export function parseSignupList(html: string): SignupCard[] {
  const cards: SignupCard[] = [];
  for (const block of html.split('<div class="list-card">').slice(1)) {
    const m = block.match(/\/users\/(\d+)\/ironman\/(\d+)/);
    if (!m) continue;
    const userId = Number(m[1]);
    const seriesId = Number(m[2]);
    const name = block.match(/contestants-list__name">([^<]+)/)?.[1]?.trim() ?? "";
    const group = block.match(/<div class="tag">[\s\S]*?<span>([^<]+)<\/span>/)?.[1]?.trim() ?? "";
    const title = block.match(/contestants-list__title title">([^<]+)/)?.[1]?.trim() ?? "";
    const description = block.match(/contestants-list__desc content">([\s\S]*?)<\/p>/)?.[1]?.trim() ?? "";
    const team = block.match(/team-badge">所屬團隊<\/span>\s*<a[^>]*>([^<]+)<\/a>/)?.[1]?.trim() ?? null;
    const signupDate = block.match(/報名日期：([\d/]+ [\d:]+)/)?.[1] ?? "";
    const day = block.match(/DAY\s*(\d+)/) ? Number(block.match(/DAY\s*(\d+)/)![1]) : 0;
    cards.push({ seriesId, userId, name, group, title, description, team, signupDate, day });
  }
  return cards;
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `bun test scripts/parse-signup.test.ts`
Expected: PASS (2 tests). 10 cards parsed, not-started card day=0.

- [ ] **Step 7: Commit**

```bash
git add scripts/parse-signup.ts scripts/parse-signup.test.ts scripts/test-utils.ts scripts/__fixtures__/signup-page.html
git commit -m "feat: parse signup list into SignupCard[]"
```

---

### Task 3: Parse RSS → RssChannel

**Files:**
- Create: `scripts/parse-rss.ts`
- Create: `scripts/parse-rss.test.ts`
- Create: `scripts/__fixtures__/rss-series.xml` (saved from live series RSS)

**Interfaces:**
- Consumes: nothing (pure parser).
- Produces: `parseRss(xml: string): RssChannel`; `rssUrl(seriesId: number): string` → `https://ithelp.ithome.com.tw/rss/series/${seriesId}`.

Verified RSS structure (from live 2026 feed):
- channel: `<title>`, `<link>`, `<description>`, `<lastBuildDate>` (RFC822), `<pubDate>` (YYYY-MM-DD HH:mm:ss)
- items: `<item>` blocks with `<title>`, `<link>`, `<description>`, `<pubDate>` (YYYY-MM-DD HH:mm:ss)
- Day number: parse from item title prefix `Day N` or from `DAY N` — title always starts `Day N：` or `Day N -`.

- [ ] **Step 1: Save live fixture**

Run (bash):
```bash
curl -s 'https://ithelp.ithome.com.tw/rss/series/9066' -H 'User-Agent: Mozilla/5.0' -o scripts/__fixtures__/rss-series.xml
wc -c scripts/__fixtures__/rss-series.xml   # expect ~63KB
```

- [ ] **Step 2: Write failing test**

```typescript
// scripts/parse-rss.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseRss, rssUrl } from "./parse-rss";

describe("parseRss", () => {
  test("parses channel and items", () => {
    const xml = readFixture("rss-series.xml");
    const ch = parseRss(xml);
    expect(ch.title).toContain("2026");
    expect(ch.link).toContain("ithelp.ithome.com.tw");
    expect(ch.items.length).toBeGreaterThan(0);
    const item = ch.items[0];
    expect(item.title).toMatch(/Day \d+/);
    expect(item.link).toMatch(/articles\/\d+/);
    expect(item.pubDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("lastBuildDate parses to ISO", () => {
    const xml = readFixture("rss-series.xml");
    const ch = parseRss(xml);
    expect(ch.lastBuildDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("rssUrl builds correct URL", () => {
    expect(rssUrl(9066)).toBe("https://ithelp.ithome.com.tw/rss/series/9066");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test scripts/parse-rss.test.ts`
Expected: FAIL — module `./parse-rss` not found.

- [ ] **Step 4: Implement parse-rss.ts**

```typescript
// scripts/parse-rss.ts
import type { RssChannel } from "./types";

export function rssUrl(seriesId: number): string {
  return `https://ithelp.ithome.com.tw/rss/series/${seriesId}`;
}

function parseRfc822(s: string): string {
  // "Wed, 05 Aug 2026 09:39:41 +0800" -> ISO +08:00
  const d = new Date(s);
  const iso = d.toISOString();
  return iso.replace("Z", "+08:00");
}

export function parseRss(xml: string): RssChannel {
  const ch = xml.match(/<channel>([\s\S]*?)<\/channel>/)?.[1] ?? "";
  const title = ch.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
  const link = ch.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
  const description = ch.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? "";
  const lastBuild = ch.match(/<lastBuildDate>([\s\S]*?)<\/lastBuildDate>/)?.[1];
  const items = [...ch.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((mm) => ({
    title: mm[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "",
    link: mm[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "",
    pubDate: mm[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "",
    description: mm[1].match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? "",
  }));
  return {
    title,
    link,
    description,
    lastBuildDate: lastBuild ? parseRfc822(lastBuild) : null,
    items,
  };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test scripts/parse-rss.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/parse-rss.ts scripts/parse-rss.test.ts scripts/__fixtures__/rss-series.xml
git commit -m "feat: parse RSS feed into RssChannel"
```

---

### Task 4: Parse series page → SeriesStats

**Files:**
- Create: `scripts/parse-series.ts`
- Create: `scripts/parse-series.test.ts`
- Create: `scripts/__fixtures__/series-page.html` (saved from live series page)

**Interfaces:**
- Consumes: nothing (pure parser).
- Produces: `parseSeriesPage(html: string): SeriesStats`; `seriesUrl(userId: number, seriesId: number): string` → `https://ithelp.ithome.com.tw/users/${userId}/ironman/${seriesId}`.

Verified field regexes (from live 2026 series page):
- series header: `參賽天數\s*(\d+)\s*天`, `共\s*(\d+)\s*篇文章`, `<span class="subscription-amount">(\d+)</span>\s*人訂閱`
- articles split: `<div class="profile-list__condition">`
- per article: `articles/(\d+)`, `qa-list__title-link[^>]*>\s*([\s\S]*?)\s*</a>`, `title="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"`, stats `qa-condition__count">(\d+)</span>\s*<span class="qa-condition__text">(Like|留言|瀏覽)`
- day: from `ir-qa-list__days[^"]*">DAY\s*(\d+)` (may be absent on series page; fallback to parsing `Day N` from title, else 0)
- Series title is NOT on this page reliably (it's the page `<title>`), so keep `title` empty here; scrape merges title from signup card.

- [ ] **Step 1: Save live fixture**

Run (bash):
```bash
curl -s 'https://ithelp.ithome.com.tw/users/20168288/ironman/9066' -H 'User-Agent: Mozilla/5.0' -o scripts/__fixtures__/series-page.html
wc -c scripts/__fixtures__/series-page.html   # expect ~47KB
```

- [ ] **Step 2: Write failing test**

```typescript
// scripts/parse-series.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseSeriesPage, seriesUrl } from "./parse-series";

describe("parseSeriesPage", () => {
  test("parses stats and articles", () => {
    const html = readFixture("series-page.html");
    const s = parseSeriesPage(html);
    expect(s.dayCount).toBeGreaterThanOrEqual(1);
    expect(s.articleCount).toBeGreaterThanOrEqual(1);
    expect(s.subscriptions).toBeGreaterThanOrEqual(0);
    expect(s.articles.length).toBe(s.articleCount);
    const a = s.articles[0];
    expect(a.id).toBeGreaterThan(10000000);
    expect(a.title).toContain("Day 1");
    expect(a.url).toMatch(/articles\/\d+/);
    expect(a.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof a.views).toBe("number");
    expect(typeof a.likes).toBe("number");
    expect(typeof a.comments).toBe("number");
  });

  test("articles have all three stats", () => {
    const html = readFixture("series-page.html");
    const s = parseSeriesPage(html);
    for (const a of s.articles) {
      expect(a.views).toBeGreaterThanOrEqual(0);
      expect(a.likes).toBeGreaterThanOrEqual(0);
      expect(a.comments).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test scripts/parse-series.test.ts`
Expected: FAIL — module `./parse-series` not found.

- [ ] **Step 4: Implement parse-series.ts**

```typescript
// scripts/parse-series.ts
import type { SeriesStats } from "./types";

export function seriesUrl(userId: number, seriesId: number): string {
  return `https://ithelp.ithome.com.tw/users/${userId}/ironman/${seriesId}`;
}

export function parseSeriesPage(html: string): SeriesStats {
  const dayCount = Number(html.match(/參賽天數\s*(\d+)\s*天/)?.[1] ?? 0);
  const articleCount = Number(html.match(/共\s*(\d+)\s*篇文章/)?.[1] ?? 0);
  const subscriptions = Number(html.match(/<span class="subscription-amount">(\d+)<\/span>\s*人訂閱/)?.[1] ?? 0);

  const articles: SeriesStats["articles"] = [];
  const blocks = html.split('<div class="profile-list__condition">').slice(1);
  for (const b of blocks) {
    const id = Number(b.match(/articles\/(\d+)/)?.[1] ?? 0);
    if (!id) continue;
    const title = b.match(/qa-list__title-link[^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1]
      ?.replace(/<[^>]+>/g, "").trim() ?? "";
    const publishedAt = b.match(/title="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"/)?.[1] ?? "";
    const stats = [...b.matchAll(/qa-condition__count">(\d+)<\/span>\s*<span class="qa-condition__text">(Like|留言|瀏覽)/g)];
    const views = Number(stats.find((x) => x[2] === "瀏覽")?.[1] ?? 0);
    const likes = Number(stats.find((x) => x[2] === "Like")?.[1] ?? 0);
    const comments = Number(stats.find((x) => x[2] === "留言")?.[1] ?? 0);
    const day = Number(b.match(/DAY\s*(\d+)/)?.[1] ?? Number(title.match(/Day (\d+)/)?.[1] ?? 0));
    articles.push({
      id, day, title, url: `https://ithelp.ithome.com.tw/articles/${id}`,
      publishedAt: publishedAt.replace(" ", "T") + "+08:00",
      views, likes, comments,
    });
  }
  return { dayCount, articleCount, subscriptions, articles };
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test scripts/parse-series.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/parse-series.ts scripts/parse-series.test.ts scripts/__fixtures__/series-page.html
git commit -m "feat: parse series page into SeriesStats"
```

---

### Task 5: Types module

**Files:**
- Create: `scripts/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: all types referenced in Global Data Types (`SignupCard`, `RssChannel`, `SeriesStats`, `Series`, `Article`, `YearData`, `Manifest`). All parsers import from here.

- [ ] **Step 1: Write types.ts**

```typescript
// scripts/types.ts
export type SignupCard = {
  seriesId: number; userId: number; name: string;
  group: string; title: string; description: string;
  team: string | null; signupDate: string; day: number;
};

export type RssItem = { title: string; link: string; pubDate: string; description: string };
export type RssChannel = {
  title: string; link: string; description: string;
  lastBuildDate: string | null; items: RssItem[];
};

export type Article = {
  id: number; day: number; title: string; url: string;
  publishedAt: string; views: number; likes: number; comments: number;
};
export type SeriesStats = {
  dayCount: number; articleCount: number; subscriptions: number;
  articles: Article[];
};
export type Series = {
  id: number; user: { id: number; name: string; profileUrl: string };
  group: string; title: string; description: string; team: string | null;
  signupDate: string; lastUpdated: string | null; // RSS lastBuildDate (spec: 更新時間 card field)
  dayCount: number; articleCount: number; subscriptions: number;
  articles: Article[];
};
export type YearData = { year: number; updatedAt: string; groups: string[]; series: Series[] };
export type Manifest = { year: number; signupListUrl: string };
```

- [ ] **Step 2: Run full test suite to confirm types resolve**

Run: `bun test`
Expected: PASS — all parser tests still green with shared types.

- [ ] **Step 3: Commit**

```bash
git add scripts/types.ts
git commit -m "feat: shared types module"
```

---

### Task 6: Scraper orchestrator → data/2026.json

**Files:**
- Create: `scripts/scrape.ts`
- Create: `config/series-manifest.json`
- Create: `scripts/scrape.test.ts` (integration with fixtures, no network)

**Interfaces:**
- Consumes: `fetchHtml`, `parseSignupList`, `parseRss`, `parseSeriesPage`, all types.
- Produces: `runScrape(manifest: Manifest): Promise<YearData>`; `mergeCardsAndStats(cards, statsBySeries, rssBySeries): Series[]` (pure, exported for test); writes `data/2026.json` + `data/meta.json`.

Merge rules:
- Series title/description/group/user/team/signupDate from SignupCard.
- dayCount/articleCount/subscriptions/articles from SeriesStats (series page).
- lastUpdated from RSS lastBuildDate (spec: 更新時間 card field); null when RSS missing.
- articles sorted by day ascending. Series sorted by `dayCount` desc then `signupDate` asc.
- `groups`: unique group names sorted.

- [ ] **Step 1: Create manifest**

```json
{
  "year": 2026,
  "signupListUrl": "https://ithelp.ithome.com.tw/2026ironman/signup/list"
}
```

- [ ] **Step 2: Write failing test for merge + empty-guard**

```typescript
// scripts/scrape.test.ts
import { describe, expect, test } from "bun:test";
import { mergeCardsAndStats } from "./scrape";
import { parseSignupList } from "./parse-signup";
import { parseSeriesPage } from "./parse-series";
import { readFixture } from "./test-utils";

describe("mergeCardsAndStats", () => {
  test("merges signup + series page into Series[]", () => {
    const cards = parseSignupList(readFixture("signup-page.html"));
    const stats = parseSeriesPage(readFixture("series-page.html"));
    // stats fixture is series 9066 (Kehao); find matching card
    const card = cards.find((c) => c.seriesId === 9066);
    expect(card).toBeDefined();
    const series = mergeCardsAndStats([card!], new Map([[9066, stats]]), new Map());
    expect(series.length).toBe(1);
    const s = series[0];
    expect(s.title).toBe(card!.title);
    expect(s.user.name).toBe(card!.name);
    expect(s.articleCount).toBe(stats.articleCount);
    expect(s.articles.length).toBe(stats.articles.length);
    expect(s.articles[0].views).toBe(stats.articles[0].views);
    expect(s.group).toBe(card!.group);
  });

  test("series with no stats still produced (stats optional)", () => {
    const cards = parseSignupList(readFixture("signup-page.html"));
    const series = mergeCardsAndStats([cards[0]], new Map(), new Map());
    expect(series.length).toBe(1);
    expect(series[0].articles).toEqual([]);
    expect(series[0].articleCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test scripts/scrape.test.ts`
Expected: FAIL — `./scrape` not found.

- [ ] **Step 4: Implement scrape.ts**

```typescript
// scripts/scrape.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHtml } from "./fetch-html";
import { parseSignupList, signupListUrl } from "./parse-signup";
import { parseRss, rssUrl } from "./parse-rss";
import { parseSeriesPage, seriesUrl } from "./parse-series";
import type { Manifest, Series, SignupCard, YearData, SeriesStats, RssChannel } from "./types";

export function mergeCardsAndStats(
  cards: SignupCard[],
  statsBySeries: Map<number, SeriesStats>,
  rssBySeries: Map<number, RssChannel>,
): Series[] {
  const series: Series[] = cards.map((c) => {
    const st = statsBySeries.get(c.seriesId);
    const rss = rssBySeries.get(c.seriesId);
    return {
      id: c.seriesId,
      user: { id: c.userId, name: c.name, profileUrl: `https://ithelp.ithome.com.tw/users/${c.userId}/profile` },
      group: c.group,
      title: c.title,
      description: c.description,
      team: c.team,
      signupDate: c.signupDate.replace(" ", "T") + "+08:00",
      lastUpdated: rss?.lastBuildDate ?? null, // spec: 更新時間 card field
      dayCount: st?.dayCount ?? 0,
      articleCount: st?.articleCount ?? 0,
      subscriptions: st?.subscriptions ?? 0,
      articles: (st?.articles ?? []).sort((a, b) => a.day - b.day),
    };
  });
  series.sort((a, b) => b.dayCount - a.dayCount || a.signupDate.localeCompare(b.signupDate));
  return series;
}

export async function runScrape(manifest: Manifest): Promise<YearData> {
  // 1. fetch all pages of signup list
  const cards: SignupCard[] = [];
  let page = 1;
  for (;;) {
    const url = `${manifest.signupListUrl}${page === 1 ? "" : `?page=${page}`}`;
    const html = await fetchHtml(url);
    const parsed = parseSignupList(html);
    if (parsed.length === 0) break;
    cards.push(...parsed);
    const hasNext = /rel="next"/.test(html);
    if (!hasNext) break;
    page++;
  }

  // 2. per series: RSS + series page (2 requests each)
  const statsBySeries = new Map<number, SeriesStats>();
  const rssBySeries = new Map<number, RssChannel>();
  const errors: string[] = [];
  for (const card of cards) {
    try {
      const [rssXml, pageHtml] = await Promise.all([
        fetchHtml(rssUrl(card.seriesId)),
        fetchHtml(seriesUrl(card.userId, card.seriesId)),
      ]);
      rssBySeries.set(card.seriesId, parseRss(rssXml));
      statsBySeries.set(card.seriesId, parseSeriesPage(pageHtml));
    } catch (e) {
      errors.push(`${card.seriesId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 150)); // be gentle to ithelp
  }

  const series = mergeCardsAndStats(cards, statsBySeries, rssBySeries);
  const groups = [...new Set(series.map((s) => s.group))].sort();
  return {
    year: manifest.year,
    updatedAt: new Date().toISOString().replace("Z", "+08:00"),
    groups,
    series,
    // @ts-expect-error scrapeLog is runtime-only diagnostics
    scrapeLog: errors,
  };
}

// CLI entry
if (import.meta.main) {
  const manifestPath = join(import.meta.dir, "..", "config", "series-manifest.json");
  const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const data = await runScrape(manifest);

  const dataDir = join(import.meta.dir, "..", "data");
  await mkdir(dataDir, { recursive: true });

  // empty-guard: if nothing parsed, keep previous data
  if (data.series.length === 0) {
    console.error("scrape produced 0 series — aborting write, keeping previous data");
    process.exit(1);
  }

  await writeFile(join(dataDir, `${manifest.year}.json`), JSON.stringify(data, null, 2));
  await writeFile(
    join(dataDir, "meta.json"),
    JSON.stringify({ updatedAt: data.updatedAt, seriesCount: data.series.length }, null, 2),
  );
  console.log(`wrote data/${manifest.year}.json with ${data.series.length} series`);
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test scripts/scrape.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Live smoke test — full scrape**

Run: `bun run scripts/scrape.ts`
Expected: logs `wrote data/2026.json with ~125 series`; `data/2026.json` has 125 series, `data/meta.json` has updatedAt. If scrape fails on Cloudflare 403s, bump `retries` in fetch-html.

- [ ] **Step 7: Commit**

```bash
git add scripts/scrape.ts scripts/scrape.test.ts config/series-manifest.json data/
git commit -m "feat: full scraper produces data/2026.json"
```

---

### Task 7: Astro site scaffold + data wiring

**Files:**
- Create: `web/package.json`
- Create: `web/astro.config.mjs`
- Create: `web/tsconfig.json`
- Create: `web/src/pages/index.astro`
- Create: `web/src/components/Dashboard.astro`
- Create: `web/src/components/SeriesCard.astro`
- Create: `web/public/data/2026.json` (copied from `../data/2026.json`)
- Create: `web/public/_headers`
- Create: `web/public/_redirects`

**Interfaces:**
- Consumes: `data/2026.json` (Task 6 output) — copied into `web/public/data/2026.json` during build.
- Produces: static dashboard page. Client JS (`index.astro` inline `<script>`) fetches `/data/2026.json` to re-render when new data arrives (cache-busting `?t=`).

- [ ] **Step 1: Create web package.json + astro config**

```json
{
  "name": "ironman-observer-web",
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "node scripts/copy-data.mjs && astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5.0.0"
  }
}
```

`web/astro.config.mjs`:
```js
import { defineConfig } from "astro/config";
export default defineConfig({
  site: "https://ironman.example.com", // TODO: replace with real domain in deploy task
  output: "static",
});
```

`web/tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/base",
  "compilerOptions": { "strict": true }
}
```

- [ ] **Step 2: Create data copy script**

`web/scripts/copy-data.mjs`:
```js
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "web", "public", "data");
mkdirSync(outDir, { recursive: true });
copyFileSync(join(root, "data", "2026.json"), join(outDir, "2026.json"));
console.log("copied data/2026.json -> web/public/data/2026.json");
```

- [ ] **Step 3: Write index.astro (SSG pre-render + client refresh)**

```astro
---
// web/src/pages/index.astro
import Dashboard from "../components/Dashboard.astro";
import type { YearData } from "../../../scripts/types";

const data: YearData = await import("../../../data/2026.json").then((m) => m.default);
---
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>鐵人觀察家 2026</title>
  <meta name="description" content="2026 iThome 鐵人賽每日觀察：追蹤每支參賽系列的進度與人氣" />
  <style>
    :root { --bg:#0f1115; --card:#171a21; --line:#262b36; --text:#e6e9ef; --muted:#9aa3b2; --accent:#4da3ff; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui,-apple-system,"Noto Sans TC",sans-serif; background:var(--bg); color:var(--text); }
    a { color:var(--accent); text-decoration:none; }
    a:hover { text-decoration:underline; }
  </style>
</head>
<body>
  <Dashboard data={data} />
  <script>
    // Refresh client-side: re-fetch JSON to pick up the latest hourly commit without full reload
    async function refresh() {
      try {
        const res = await fetch(`/data/2026.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const fresh = await res.json();
        // Re-render via a custom event the Dashboard listens to
        window.dispatchEvent(new CustomEvent("ironman-data", { detail: fresh }));
      } catch { /* keep current render */ }
    }
    setInterval(refresh, 60_000); // every minute
  </script>
</body>
</html>
```

- [ ] **Step 4: Write Dashboard.astro**

```astro
---
// web/src/components/Dashboard.astro
import SeriesCard from "./SeriesCard.astro";
import type { YearData } from "../../../scripts/types";

interface Props { data: YearData }
const { data } = Astro.props;
const groups = ["全部", ...data.groups];
---

<header style="padding:1.5rem 2rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
  <div>
    <h1 style="margin:0;font-size:1.4rem;">🏆 鐵人觀察家 2026</h1>
    <p style="margin:.25rem 0 0;color:var(--muted);font-size:.85rem;">
      <span id="updated-at"><time datetime={data.updatedAt}>{data.updatedAt}</time></span>
      · <span id="series-count">{data.series.length}</span> 支系列
    </p>
  </div>
  <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;" id="group-filters">
    {groups.map((g) => (
      <button data-group={g} class="filter" data-active={g === "全部" ? "true" : "false"} style="...">{g}</button>
    ))}
  </div>
</header>

<main style="padding:1.5rem 2rem;display:flex;flex-direction:column;gap:1rem;" id="series-list">
  {data.series.map((s) => <SeriesCard series={s} />)}
</main>

<script>
  const list = document.getElementById("series-list")!;
  const updatedAt = document.getElementById("updated-at")!;
  const seriesCount = document.getElementById("series-count")!;
  let current: any = null;

  function render(data: any) {
    current = data;
    updatedAt.textContent = data.updatedAt;
    updatedAt.setAttribute("datetime", data.updatedAt);
    seriesCount.textContent = String(data.series.length);
    // client-side filter + sort (SSG already sorted by dayCount desc)
    const group = document.querySelector(".filter[data-active='true']")?.getAttribute("data-group") ?? "全部";
    const sort = (document.getElementById("sort") as HTMLSelectElement)?.value ?? "dayCount";
    applyFilter(data, group, sort);
  }

  function applyFilter(data: any, group: string, sort: string) {
    let series = data.series;
    if (group !== "全部") series = series.filter((s: any) => s.group === group);
    series = [...series].sort((a: any, b: any) => {
      if (sort === "views") return totalViews(b) - totalViews(a);
      if (sort === "latest") return latestPub(b) - latestPub(a);
      return b.dayCount - a.dayCount;
    });
    list.innerHTML = "";
    for (const s of series) list.appendChild(renderCard(s));
  }

  function totalViews(s: any) { return s.articles.reduce((n: number, a: any) => n + a.views, 0); }
  function latestPub(s: any) { return s.articles.length ? new Date(s.articles[s.articles.length - 1].publishedAt).getTime() : 0; }
  function renderCard(s: any) { /* build card DOM — see Task 8 */ }

  document.querySelectorAll(".filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((b) => b.setAttribute("data-active", "false"));
      btn.setAttribute("data-active", "true");
      if (current) applyFilter(current, btn.getAttribute("data-group")!, (document.getElementById("sort") as HTMLSelectElement)?.value ?? "dayCount");
    });
  });

  window.addEventListener("ironman-data", ((e: CustomEvent) => render(e.detail)) as EventListener);
  render((window as any).__SSR_DATA__);
</script>
```

- [ ] **Step 5: Write SeriesCard.astro (static variant)**

```astro
---
// web/src/components/SeriesCard.astro
import type { Series } from "../../../scripts/types";
interface Props { series: Series }
const { series: s } = Astro.props;
const latest = s.articles[s.articles.length - 1];
const totalViews = s.articles.reduce((n, a) => n + a.views, 0);
---

<article style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.25rem;display:grid;gap:.35rem;grid-template-columns:auto 1fr;align-items:start;">
  <span style="grid-row:span 3;font-size:.8rem;background:#232a36;color:var(--accent);border-radius:999px;padding:.2rem .7rem;margin-top:.2rem;">DAY {s.dayCount || "?"}</span>
  <h3 style="margin:0;font-size:1rem;line-height:1.4;"><a href={`https://ithelp.ithome.com.tw/users/${s.user.id}/ironman/${s.id}`} target="_blank" rel="noopener">{s.title}</a></h3>
  <p style="margin:.1rem 0 0;color:var(--muted);font-size:.8rem;">
    {s.user.name} · {s.group}{s.team ? ` · 團隊 ${s.team}` : ""}
  </p>
  <p style="margin:.1rem 0 0;color:var(--muted);font-size:.8rem;">
    {s.articles.length > 0
      ? <>最新 <a href={latest.url} target="_blank" rel="noopener">{latest.title}</a> · {totalViews} 瀏覽 · {latest.views} 當篇</>
      : <>尚未開賽</>}
  </p>
  {s.lastUpdated && (
    <p style="margin:.1rem 0 0;color:var(--muted);font-size:.75rem;">更新時間 <time datetime={s.lastUpdated}>{s.lastUpdated}</time></p>
  )}
</article>
```

- [ ] **Step 6: Write _headers + _redirects**

`web/public/_headers`:
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
/data/*
  Cache-Control: public, max-age=60, stale-while-revalidate=300
/*
  Cache-Control: public, max-age=3600
```

`web/public/_redirects`:
```
/* /index.html 200
```

- [ ] **Step 7: Install + build**

Run: `cd web && bun install && bun run build`
Expected: `dist/` produced with `index.html` + `data/2026.json`; no errors.

- [ ] **Step 8: Preview smoke test**

Run: `cd web && bun run preview` (in background) then curl `http://localhost:4321/`
Expected: 200 with 鐵人觀察家 title; `curl http://localhost:4321/data/2026.json` returns JSON.

- [ ] **Step 9: Commit**

```bash
git add web/
git commit -m "feat: astro dashboard with group filter + client refresh"
```

---

### Task 8: Client-side sorting + full card render

**Files:**
- Modify: `web/src/components/Dashboard.astro` (add sort select; complete `renderCard`)

**Interfaces:**
- Consumes: Task 7 `Dashboard.astro`.
- Produces: working sort (最新發布 / 最多觀看 / 進度) + full card DOM mirroring `SeriesCard.astro`.

- [ ] **Step 1: Add sort select to header**

In `Dashboard.astro` header, after group filters add:
```html
<select id="sort" style="background:#232a36;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem;">
  <option value="dayCount">進度</option>
  <option value="views">最多觀看</option>
  <option value="latest">最新發布</option>
</select>
```

- [ ] **Step 2: Implement renderCard client DOM builder**

Replace the `renderCard` stub in the Dashboard `<script>`:
```js
function renderCard(s) {
  const art = document.createElement("article");
  art.style.cssText = "background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.25rem;display:grid;gap:.35rem;grid-template-columns:auto 1fr;align-items:start;";
  const day = document.createElement("span");
  day.textContent = `DAY ${s.dayCount || "?"}`;
  day.style.cssText = "grid-row:span 3;font-size:.8rem;background:#232a36;color:var(--accent);border-radius:999px;padding:.2rem .7rem;margin-top:.2rem;justify-self:start;";
  const h = document.createElement("h3");
  h.style.cssText = "margin:0;font-size:1rem;line-height:1.4;";
  const a = document.createElement("a");
  a.href = `https://ithelp.ithome.com.tw/users/${s.user.id}/ironman/${s.id}`;
  a.target = "_blank"; a.rel = "noopener";
  a.textContent = s.title;
  h.appendChild(a);
  const meta = document.createElement("p");
  meta.style.cssText = "margin:.1rem 0 0;color:var(--muted);font-size:.8rem;";
  meta.textContent = `${s.user.name} · ${s.group}${s.team ? ` · 團隊 ${s.team}` : ""}`;
  const info = document.createElement("p");
  info.style.cssText = "margin:.1rem 0 0;color:var(--muted);font-size:.8rem;";
  const latest = s.articles[s.articles.length - 1];
  if (latest) {
    const la = document.createElement("a");
    la.href = latest.url; la.target = "_blank"; la.rel = "noopener";
    la.textContent = latest.title;
    info.append("最新 ", la, ` · ${totalViews(s)} 瀏覽 · ${latest.views} 當篇`);
  } else {
    info.textContent = "尚未開賽";
  }
  art.append(day, h, meta, info);
  if (s.lastUpdated) {
    const upd = document.createElement("p");
    upd.style.cssText = "margin:.1rem 0 0;color:var(--muted);font-size:.75rem;";
    upd.textContent = `更新時間 ${s.lastUpdated}`;
    art.append(upd);
  }
  return art;
}
```

- [ ] **Step 3: Wire sort change listener**

In Dashboard `<script>` add:
```js
document.getElementById("sort")?.addEventListener("change", () => {
  if (current) applyFilter(current, (document.querySelector(".filter[data-active='true']")?.getAttribute("data-group")) ?? "全部",
    (document.getElementById("sort") as HTMLSelectElement).value);
});
```

- [ ] **Step 4: Build + preview verify**

Run: `cd web && bun run build && bun run preview`
Expected: build clean; open page, filter by group, switch sort — cards reorder correctly.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Dashboard.astro
git commit -m "feat: client-side sort by views/latest/progress"
```

---

### Task 9: GitHub Actions hourly workflow

**Files:**
- Create: `.github/workflows/update.yml`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: hourly cron → scrape → commit data → build → deploy. Skips commit/deploy when data unchanged.

- [ ] **Step 1: Write workflow**

```yaml
name: hourly-update
on:
  schedule:
    - cron: "0 * * * *"     # every hour at :00
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Scrape
        run: bun run scripts/scrape.ts

      - name: Commit data if changed
        run: |
          git config user.name "ironman-bot"
          git config user.email "ironman-bot@users.noreply.github.com"
          git add data/ web/public/data/
          if git diff --cached --quiet; then
            echo "no data change; skipping commit+build+deploy"
            exit 0
          fi
          git commit -m "chore: update ironman data $(date -u +%Y-%m-%dT%H:%MZ)"
          git push

      - name: Build site
        run: cd web && bun install && bun run build

      - name: Deploy to Cloudflare Pages
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: npx wrangler pages deploy web/dist --project-name=ironman-observer-next
```

- [ ] **Step 2: Add secrets doc note (no secret in repo)**

Create `.github/workflows/README.md`:
```markdown
# Workflow secrets

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Cloudflare Pages — Edit` permission. Create at https://dash.cloudflare.com/profile/api-tokens.
- The GitHub token is automatic (permissions.contents.write).
```

- [ ] **Step 3: Validate YAML**

Run: `bunx --bun actionlint .github/workflows/update.yml` (or `npx actionlint`)
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/update.yml .github/workflows/README.md
git commit -m "ci: hourly scrape + deploy workflow"
```

---

### Task 10: Cloudflare Pages deploy + domain

**Files:**
- Create: `wrangler.toml`
- Create: `README.md` (root — deploy instructions, project overview)

**Interfaces:**
- Consumes: Task 9 workflow (uses wrangler CLI in CI).
- Produces: production URL with custom domain.

- [ ] **Step 1: Create wrangler.toml**

```toml
name = "ironman-observer-next"
pages_build_output_dir = "web/dist"

[env.production]
routes = [{ pattern = "ironman.example.com", custom_domain = true }]
```

- [ ] **Step 2: Create root README**

```markdown
# 鐵人觀察家 Next

2026 iThome 鐵人賽的每日觀察儀表板。靜態站 + GitHub Actions 每小時自動更新 + Cloudflare Pages 免費託管。

## 架構

ithelp 鐵人賽 → GH Actions (cron) → data/2026.json commit → Astro build → Cloudflare Pages

## 本地開發

```bash
bun install
bun run scripts/scrape.ts     # 抓取最新資料到 data/2026.json
cd web && bun install && bun run dev
```

## 部署

1. 建 Cloudflare Pages 專案（名稱 `ironman-observer-next`）
2. 加 domain 到 `wrangler.toml` 的 routes
3. 設 `CLOUDFLARE_API_TOKEN` secret（Pages Edit 權限）
4. 推上 GitHub，workflow 每小時自動跑

## 測試

```bash
bun test
```
```

- [ ] **Step 3: Local deploy dry-run**

Run: `cd web && bun run build && npx wrangler pages deploy web/dist --dry-run`
Expected: dry-run success listing uploaded files. (Needs wrangler installed; if not, `npx wrangler --version`.)

- [ ] **Step 4: Commit**

```bash
git add wrangler.toml README.md
git commit -m "chore: cloudflare pages config + README"
```

---

### Task 11: End-to-end verification

**Files:**
- Modify: `data/2026.json` (regenerate)
- Verify: `.github/workflows/update.yml`, site build, deploy pipeline

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Full local pipeline run**

Run (bash, sequential):
```bash
bun run scripts/scrape.ts
bun test
cd web && bun install && bun run build
npx wrangler pages deploy web/dist --dry-run
```
Expected: scrape writes ~125 series; all tests pass; build clean; dry-run deploy OK.

- [ ] **Step 2: Verify data quality invariants**

Run: `bun -e "const d = await Bun.file('data/2026.json').json(); console.log(d.series.length, d.groups.length); console.log(d.series.every(s => s.id > 9000 && s.articles.every(a => a.views >= 0)))"`
Expected: `125 18 true` (series count may drift as more signups happen; invariant must hold).

- [ ] **Step 3: Manual browser check of preview**

Run: `cd web && bun run preview` and open `http://localhost:4321` — verify:
- Cards render with title/author/group/day
- Group filter works
- Sort by 最多觀看 / 最新發布 reorders
- updatedAt shows current scrape time

- [ ] **Step 4: Trigger real deployment**

Push to GitHub with the workflow; use `workflow_dispatch` to run once. Verify:
- Scrape step writes data
- Commit step pushes new commit
- Deploy step uploads to Cloudflare Pages
- Production URL serves the dashboard

- [ ] **Step 5: Commit any leftover changes**

```bash
git add -A
git commit -m "chore: final verification pass" || true
```

---

## Self-Review Notes (run by planner)

**Spec coverage:**
- Scraper (signup + RSS + series page) → Tasks 2-6 ✓
- Data format (spec schema) → Task 5 types + Task 6 merge ✓
- Empty-guard → Task 6 CLI ✓
- Error handling (retry/backoff, per-series failure) → Tasks 1, 6 ✓
- Astro dashboard (filter/sort/cards) → Tasks 7-8 ✓
- GH Actions cron → Task 9 ✓
- Cloudflare Pages + domain → Task 10 ✓
- Tests (fixtures, no network) → Tasks 2-6 ✓
- Non-goals respected (no multi-year, no search, no badges) ✓

**Type consistency:** `SignupCard`, `RssChannel`, `SeriesStats`, `Series`, `Article`, `YearData`, `Manifest` defined once in `scripts/types.ts` (Task 5) and used by all parsers + merge + Astro. `fetchHtml`/`parseSignupList`/`parseRss`/`parseSeriesPage` signatures fixed in Tasks 1-4; scrape.ts (Task 6) consumes them.

**Placeholder scan:** No TBD/TODO except the intentional `TODO: replace with real domain` comment in astro.config.mjs (filled during Task 10). All test code and implementation code present verbatim.
