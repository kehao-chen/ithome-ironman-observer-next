import { describe, expect, test } from "bun:test";
import { loadFamousAuthors, matchFamousAuthors, isSafeUrl, safeHref, getAvatarChar, famousProfileViewModel, type FamousRow } from "./hall-of-fame";
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

  test("exact-set：完整 8 位名人資料格式與 ID 集合驗證", () => {
    const expectedIds = new Set([
      20065770, 20040221, 20083608, 20109516,
      20161809, 20120030, 20133765, 20104930,
    ]);
    const authors = loadFamousAuthors();
    expect(authors.length).toBe(8);
    expect(new Set(authors.map((a) => a.id))).toEqual(expectedIds);

    for (const author of authors) {
      expect(typeof author.name).toBe("string");
      expect(author.name.trim().length).toBeGreaterThan(0);
      expect(typeof author.bio).toBe("string");
      expect(author.bio.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(author.categories)).toBe(true);
      expect(author.categories.length).toBeGreaterThan(0);
      expect(Array.isArray(author.credentials)).toBe(true);
      expect(author.credentials.length).toBeGreaterThan(0);

      for (const cred of author.credentials) {
        expect(typeof cred.label).toBe("string");
        expect(cred.label.trim().length).toBeGreaterThan(0);
        expect(isSafeUrl(cred.url)).toBe(true);
      }
    }
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
      series({ id: 2, user: { id: 999, name: "無名", profileUrl: "x" }, articles: [{ id: 2, day: 1, title: "b", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 200, likes: 0, comments: 0 }] }),
    ], scrapeLog: [] };
    const rows = matchFamousAuthors(
      [...entries, { id: 999, name: "無名", bio: "", credentials: [], categories: [] }],
      data,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].entry.id).toBe(999); // totalViews 200（高者）→ desc 在前；升序會 fail
    expect(rows[0].totalViews).toBe(200);
    expect(rows[1].entry.id).toBe(20065770);
    expect(rows[1].totalViews).toBe(100);
  });

  test("compact（sumViews）與 full（articles 求和）totalViews 一致", () => {
    const full: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "x" }, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 150, likes: 0, comments: 0 }] }),
    ], scrapeLog: [] };
    const compact: YearData = { year: 2026, updatedAt: "2026-08-19T12:00:00+08:00", groups: [], series: [
      { ...full.series[0], sumViews: 150, articles: [{ id: 1, day: 1, title: "a", url: "u", publishedAt: "2026-08-01T00:00:00+08:00", views: 150, likes: 0, comments: 0 }] } as Series & { sumViews?: number },
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

describe("getAvatarChar", () => {
  test("處理英文（轉大寫）、中文、前後空白與空字串 fallback", () => {
    expect(getAvatarChar(" Oberon Lai ")).toBe("O");
    expect(getAvatarChar("chia7712")).toBe("C");
    expect(getAvatarChar("大魔術熊貓工程師")).toBe("大");
    expect(getAvatarChar("   ")).toBe("?");
    expect(getAvatarChar("")).toBe("?");
  });
});

describe("famousProfileViewModel", () => {
  test("轉換 FamousRow 為 FamousProfileViewModel，包含 anchorId, avatarChar, statsText, seriesCount, profileUrl, categories 與 safe credential URLs", () => {
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
      series: [series({ id: 1, user: { id: 20065770, name: "高見龍", profileUrl: "" } })],
      totalViews: 38400
    };
    const vm = famousProfileViewModel(row);
    expect(vm.id).toBe(20065770);
    expect(vm.anchorId).toBe("hof-person-20065770");
    expect(vm.name).toBe("高見龍");
    expect(vm.avatarChar).toBe("高");
    expect(vm.profileUrl).toBe("https://ithelp.ithome.com.tw/users/20065770");
    expect(vm.bio).toBe("五倍紅寶石創辦人");
    expect(vm.statsText).toBe("38,400 總瀏覽 · 1 系列");
    expect(vm.seriesCount).toBe(1);
    expect(vm.categories).toEqual([
      { id: "speaker", label: "講師" },
      { id: "community", label: "社群" }
    ]);
    expect(vm.credentials[0]).toEqual({ label: "COSCUP 講師", url: "https://coscup.org/" });
    expect(vm.credentials[1]).toEqual({ label: "危險連結", url: null });
  });

  test("完整類別對應：speaker->講師, community->社群, oss->開源, book->書籍", () => {
    const row: FamousRow = {
      entry: {
        id: 20161809,
        name: " kojenchieh ",
        bio: "敏捷三叔公",
        credentials: [],
        categories: ["speaker", "community", "oss", "book"]
      },
      series: [
        series({ id: 1, user: { id: 20161809, name: "kojenchieh", profileUrl: "" } }),
        series({ id: 2, user: { id: 20161809, name: "kojenchieh", profileUrl: "" } }),
      ],
      totalViews: 1234567
    };
    const vm = famousProfileViewModel(row);
    expect(vm.avatarChar).toBe("K");
    expect(vm.name).toBe("kojenchieh");
    expect(vm.statsText).toBe("1,234,567 總瀏覽 · 2 系列");
    expect(vm.seriesCount).toBe(2);
    expect(vm.categories).toEqual([
      { id: "speaker", label: "講師" },
      { id: "community", label: "社群" },
      { id: "oss", label: "開源" },
      { id: "book", label: "書籍" }
    ]);
  });
});
