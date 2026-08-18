// web/src/lib/teams.test.ts
import { describe, expect, test } from "bun:test";
import { aggregateTeams, sortTeamRows, teamNames, type TeamRow } from "./teams";
import realData from "../../../data/2026.json";
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
      makeSeries({ id: 1, team: "T", dayCount: 10, articles: [makeArticle({ publishedAt: "2026-08-11T10:00:00+08:00", views: 100 })] }),
      makeSeries({ id: 2, team: "T", dayCount: 6, articles: [makeArticle({ publishedAt: "2026-08-10T10:00:00+08:00", views: 200 })] }),
    ]);
    const [row] = aggregateTeams(year, TODAY);
    expect(row.name).toBe("T");
    expect(row.memberCount).toBe(2);
    expect(row.totalViews).toBe(300);
    expect(row.avgViews).toBe(150);
    expect(row.avgProgress).toBe(8);
    expect(row.postedToday).toBe(1); // 只有 id 1 是今日
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
      makeSeries({ id: 4, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "2026-08-11T10:00:00+08:00", views: 1 })] }), // 今日 → 無警示
    ]);
    const [row] = aggregateTeams(year, TODAY);
    expect(row.postedToday).toBe(1);
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
      makeSeries({ id: 1, team: "T", dayCount: 5, articles: [makeArticle({ publishedAt: "garbage", views: 1 })] }), // 缺陷 → 不算缺發
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

  test("真實資料 sweep：8 隊、33 成員、數值與手算一致", () => {
    const rows = aggregateTeams(realData, realData.updatedAt.slice(0, 10));
    expect(rows).toHaveLength(8);
    expect(rows.reduce((n, r) => n + r.memberCount, 0)).toBe(33);
    const top = rows[0]; // 總瀏覽 desc 主排序預設
    expect(top.name).toBe("五人成行，Bug 不行");
    expect(top.totalViews).toBeGreaterThan(8000);
    expect(top.avgViews).toBe(Math.floor(top.totalViews / 5));
    expect(top.avgProgress).toBeGreaterThan(16);
    expect(top.postedToday).toBe(2);
    expect(top.staleCount).toBe(0);
    expect(top.alertSummary).toContain("今日缺發 3 人");
    // 未開賽團隊不落入 alertSummary（源來適愛開緣 9 人全未開賽 → 未開賽 9 人）
    const last = rows[rows.length - 1]; // 總瀏覽 0 的未開賽團隊
    expect(last.totalViews).toBe(0);
    expect(last.alertSummary).toContain("未開賽");
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
