import { describe, expect, test } from "bun:test";
import { loadFamousAuthors, matchFamousAuthors, isSafeUrl, safeHref } from "./hall-of-fame";
import type { Series, YearData } from "../../../scripts/types";
import realData from "../../../data/2026.json";

function series(partial: Partial<Series> & { id: number; user: Series["user"] }): Series {
  return {
    group: "Software Development",
    title: "測試系列",
    description: "",
    team: null,
    signupDate: "2026/08/01T00:00:00+08:00",
    lastUpdated: null,
    dayCount: 1,
    articleCount: 1,
    subscriptions: 0,
    articles: [],
    ...partial,
  };
}

describe("loadFamousAuthors", () => {
  test("JSON key 轉 number 進 entry.id", () => {
    const entries = loadFamousAuthors();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(Number.isInteger(e.id)).toBe(true);
      expect(typeof e.name).toBe("string");
      expect(typeof e.bio).toBe("string");
      expect(e.credentials.length).toBeGreaterThan(0);
      for (const c of e.credentials) {
        expect(typeof c.label).toBe("string");
        expect(isSafeUrl(c.url)).toBe(true);
      }
      expect(e.categories.length).toBeGreaterThan(0);
      for (const cat of e.categories) {
        expect(["speaker", "community", "oss", "book"]).toContain(cat);
      }
    }
  });

  test("高見龍 (20065770) 在名單內", () => {
    const entries = loadFamousAuthors();
    const kao = entries.find((e) => e.id === 20065770);
    expect(kao).toBeDefined();
    expect(kao!.name).toBe("高見龍");
  });
});

describe("matchFamousAuthors", () => {
  const entries = loadFamousAuthors();

  test("entry.id join 出該名人系列；無系列名人排除", () => {
    const data: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "https://ithelp.ithome.com.tw/users/20065770/profile" } }),
      series({ id: 2, user: { id: 999, name: "無名", profileUrl: "https://ithelp.ithome.com.tw/users/999/profile" } }),
    ], scrapeLog: [] };
    const rows = matchFamousAuthors(entries, data);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry.id).toBe(20065770);
    expect(rows[0].series).toHaveLength(1);
    expect(rows[0].series[0].id).toBe(1);
  });

  test("該年度無系列 → 排除（隱藏）", () => {
    const data: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [], scrapeLog: [] };
    expect(matchFamousAuthors(entries, data)).toHaveLength(0);
  });

  test("totalViews 依 totalViewsOf 語意；排序 desc", () => {
    const data: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "x" }, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 100, likes: 0, comments: 0 }] }),
      series({ id: 2, user: { id: 20065770, name: "高見龍", profileUrl: "x" }, articles: [{ id: 2, day: 1, title: "b", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 200, likes: 0, comments: 0 }] }),
    ], scrapeLog: [] };
    const rows = matchFamousAuthors(entries, data);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalViews).toBe(300);
  });

  test("compact（sumViews）與 full（articles 求和）totalViews 一致", () => {
    const full: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "x" }, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 150, likes: 0, comments: 0 }] }),
    ], scrapeLog: [] };
    const compact: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      { ...full.series[0], sumViews: 150, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 150, likes: 0, comments: 0 }] },
    ], scrapeLog: [] };
    expect(matchFamousAuthors(entries, full)[0].totalViews).toBe(150);
    expect(matchFamousAuthors(entries, compact)[0].totalViews).toBe(150);
  });

  test("真實資料 sweep：名單每個 id 都存在且至少 1 個系列", () => {
    const data = realData as unknown as YearData;
    for (const e of entries) {
      const matches = data.series.filter((s) => s.user.id === e.id);
      expect(matches.length).toBeGreaterThan(0);
      const nameMatches = matches.filter((s) => s.user.name === e.name);
      if (nameMatches.length === 0) {
        console.warn(`[hall-of-fame] name mismatch: entry "${e.name}" (id ${e.id}) 在資料中的名稱為 "${matches[0]?.user.name}"`);
      }
    }
  });
});

describe("isSafeUrl", () => {
  test("合法 http(s) 通過", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
  });
  test("scheme 大小寫接受", () => {
    expect(isSafeUrl("HTTPS://example.com")).toBe(true);
  });
  test("不安全 URL 拒絕", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("Javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    expect(isSafeUrl("//evil.example")).toBe(false);
    expect(isSafeUrl("https:example.com")).toBe(false);
    expect(isSafeUrl("/users/20065770/profile")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl("  https://x  ")).toBe(false);
  });
  test("safeHref：合法回傳原 URL，不合法回傳 null", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("")).toBeNull();
  });
});
