import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMeta, collectYears, commitWrites, stageWrites, runScrape } from "./scrape";
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

describe("two-phase atomic write", () => {
  const dir = () => mkdtemp(join(tmpdir(), "scrape-cli-"));
  const cleanup = (d: string) => rm(d, { recursive: true, force: true });

  test("stageWrites creates .tmp siblings; finals untouched until commitWrites", async () => {
    const d = await dir();
    try {
      // Pre-existing data stays readable while staging is in flight.
      await writeFile(join(d, "2025.json"), "old 2025");
      await writeFile(join(d, "meta.json"), "old meta");
      const meta = buildMeta([data(2025, 2), data(2026, 5)]);
      const staged = await stageWrites(d, [data(2025, 2), data(2026, 5)], meta);
      expect(staged.map((s) => s.finalPath)).toEqual([join(d, "2025.json"), join(d, "2026.json"), join(d, "meta.json")]);
      // Finals untouched, temps staged, meta staged last.
      expect(await readFile(join(d, "2025.json"), "utf-8")).toBe("old 2025");
      expect(await readFile(join(d, "meta.json"), "utf-8")).toBe("old meta");
      expect(await readFile(join(d, "2025.json.tmp"), "utf-8")).toBe(JSON.stringify(data(2025, 2), null, 2));
      expect(await readFile(join(d, "2026.json.tmp"), "utf-8")).toBe(JSON.stringify(data(2026, 5), null, 2));
      expect(await readFile(join(d, "meta.json.tmp"), "utf-8")).toBe(JSON.stringify(meta, null, 2));
    } finally { await cleanup(d); }
  });

  test("commitWrites renames temps into place, replacing previous finals", async () => {
    const d = await dir();
    try {
      await writeFile(join(d, "2026.json"), "old 2026");
      const meta = buildMeta([data(2026, 3)]);
      const staged = await stageWrites(d, [data(2026, 3)], meta);
      await commitWrites(staged);
      expect(await readFile(join(d, "2026.json"), "utf-8")).toBe(JSON.stringify(data(2026, 3), null, 2));
      expect(await readFile(join(d, "meta.json"), "utf-8")).toBe(JSON.stringify(meta, null, 2));
      // No .tmp or .bak leftovers.
      expect((await import("node:fs")).readdirSync(d).sort()).toEqual(["2026.json", "meta.json"]);
    } finally { await cleanup(d); }
  });

  test("mid-commit failure rolls back already-replaced finals and cleans up", async () => {
    const d = await dir();
    try {
      // Pre-existing finals from the previous successful run.
      await writeFile(join(d, "2025.json"), "old 2025");
      await writeFile(join(d, "meta.json"), "old meta");
      // Sabotage the SECOND rename: a directory at a later finalPath makes
      // rename(tmp, finalPath) fail on POSIX, forcing a rollback of the FIRST
      // file, which has already been renamed into place by then.
      await mkdir(join(d, "2026.json"));
      const meta = buildMeta([data(2025, 2), data(2026, 5)]);
      const staged = await stageWrites(d, [data(2025, 2), data(2026, 5)], meta);
      await expect(commitWrites(staged)).rejects.toThrow();
      // The already-replaced 2025.json must be restored to its original content.
      expect(await readFile(join(d, "2025.json"), "utf-8")).toBe("old 2025");
      // The sabotaged target is untouched (still a directory), and its backup
      // copy was removed; meta.json was never renamed (third in order).
      expect((await import("node:fs")).statSync(join(d, "2026.json")).isDirectory()).toBe(true);
      expect(await readFile(join(d, "meta.json"), "utf-8")).toBe("old meta");
      // No .bak or .tmp residue.
      expect((await import("node:fs")).readdirSync(d).sort()).toEqual(["2025.json", "2026.json", "meta.json"]);
    } finally { await cleanup(d); }
  });
});

describe("runScrape integration", () => {
  const m2026: Manifest = { year: 2026, signupListUrl: "https://ithelp/2026ironman/signup/list" };
  const signupHtml = `
    <div class="list-card">
      <a href="https://ithelp.ithome.com.tw/users/20183319/ironman/9029"></a>
      <span class="contestants-list__name">Tim</span>
      <div class="tag"><span>Software</span></div>
      <h3 class="contestants-list__title title">AI Compiler</h3>
      <p class="contestants-list__desc content">desc</p>
      <span class="signup-date">報名日期：2026/08/01 12:00:00</span>
    </div>`;

  test("runScrape aggregates fresh series and sorts by dayCount desc", async () => {
    const rssXml = `<channel><lastBuildDate>Fri, 21 Aug 2026 09:45:10 +0800</lastBuildDate><item><title>D1</title><link>https://ithelp/articles/1</link></item></channel>`;
    const seriesPageHtml = `
      <div class="board leftside profile-main">
        <div class="qa-list__info qa-list__info--ironman subscription-group">
          <span>參賽天數 1 天 ｜</span><span>共 1 篇文章 ｜</span><span class="subscription-amount">3</span>人訂閱
        </div>
        <div class="qa-list profile-list ir-profile-list">
          <div class="profile-list__condition">
            <div class="ir-qa-list__status"><span class="ir-qa-list__days">DAY 1</span></div>
            <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/10400001" class="qa-list__title-link">Day 1｜標題 1</a></h3>
            <div class="qa-list__info"><a title="2026-08-01 10:00:00" class="qa-list__info-time"></a></div>
            <span class="qa-condition__count">100</span><span class="qa-condition__text">瀏覽</span>
          </div>
        </div>
      </div>`;
    const articleHtml = `<div class="ir-article"><span class="ir-article__days-num">1</span></div>`;

    const fetcher = async (url: string) => {
      if (url.includes("/signup/list")) return signupHtml;
      if (url.includes("/rss/series/")) return rssXml;
      if (url.includes("/articles/")) return articleHtml;
      return seriesPageHtml;
    };

    const yearData = await runScrape(m2026, { full: true, fetcher });
    expect(yearData.year).toBe(2026);
    expect(yearData.series.length).toBe(1);
    expect(yearData.series[0].id).toBe(9029);
    expect(yearData.series[0].dayCount).toBe(1);
    expect(yearData.series[0].articleCount).toBe(1);
    expect(yearData.scrapeLog).toEqual([]);
  });

  test("runScrape logs stale and failed appropriately", async () => {
    const fetcher = async (url: string) => {
      if (url.includes("/signup/list")) return signupHtml;
      throw new Error("network timeout");
    };

    // With cache -> stale
    const cachedYear: YearData = {
      year: 2026, updatedAt: "2026-08-20 10:00:00+08:00", groups: ["Software"],
      series: [{
        id: 9029, user: { id: 20183319, name: "Tim", profileUrl: "p" }, group: "Software", title: "AI Compiler", description: "desc",
        team: null, signupDate: "2026-08-01T12:00:00+08:00", lastUpdated: null,
        dayCount: 5, articleCount: 5, subscriptions: 2, articles: [],
      }],
      scrapeLog: [],
    };

    const yearData = await runScrape(m2026, { cachedYearData: cachedYear, fetcher });
    expect(yearData.series.length).toBe(1);
    expect(yearData.series[0].dayCount).toBe(5);
    expect(yearData.scrapeLog.length).toBe(1);
    expect(yearData.scrapeLog[0]).toContain("[stale] 9029");
  });
});
