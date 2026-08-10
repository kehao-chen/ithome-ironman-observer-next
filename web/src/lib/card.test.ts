import { describe, expect, test } from "bun:test";
import { cardViewModel, chipClassOf, signupDateText, totalViewsOf, type ViewSeries } from "./card";
import type { Series } from "../../../scripts/types";

const TODAY = "2026-08-07";

function makeSeries(partial: Partial<Series> & { sumViews?: number }): ViewSeries {
  const base: Series = {
    id: 9034,
    user: { id: 20118581, name: "SQLMASTER", profileUrl: "https://ithelp.ithome.com.tw/users/20118581" },
    group: "自我挑戰組",
    title: "SQL Server 基礎&調教",
    description: "",
    team: null,
    signupDate: "2026/08/01T12:07:01+08:00",
    lastUpdated: null,
    dayCount: 7,
    articleCount: 7,
    subscriptions: 10,
    articles: [
      { id: 1, day: 1, title: "Day 1", url: "https://ithelp.ithome.com.tw/articles/1", publishedAt: "2026-08-01T12:00:00+08:00", views: 10, likes: 0, comments: 0 },
      { id: 7, day: 7, title: "Day 7", url: "https://ithelp.ithome.com.tw/articles/7", publishedAt: "2026-08-07T13:00:00+08:00", views: 99, likes: 1, comments: 2 },
    ],
  };
  return { ...base, ...partial };
}

describe("cardViewModel — badge / 進度", () => {
  test("進行中：DAY n、真實進度、今日發文 chip", () => {
    const v = cardViewModel(makeSeries({}), TODAY);
    expect(v.badgeClass).toBe("day-badge");
    expect(v.badgeText).toBe("DAY 7");
    expect(v.progressLabel).toBe("7/30");
    expect(v.progressPct).toBeCloseTo(23.33, 1);
    expect(v.progressFillClass).toBe("progress-fill");
    expect(v.chipText).toBe("今日發文");
    expect(v.chipClass).toBe("status-chip");
  });
  test("完賽：DAY≥30 → 完賽 + 滿條 + 鐵人煉成", () => {
    const v = cardViewModel(makeSeries({ dayCount: 30, articleCount: 30 }), TODAY);
    expect(v.badgeText).toBe("完賽");
    expect(v.badgeClass).toBe("day-badge day-badge--done");
    expect(v.progressLabel).toBe("30/30");
    expect(v.progressPct).toBe(100);
    expect(v.progressFillClass).toBe("progress-fill progress-fill--done");
    expect(v.chipText).toBe("鐵人煉成");
  });
  test("進度 clamp：dayCount 40 → 100% / 30/30", () => {
    const v = cardViewModel(makeSeries({ dayCount: 40, articleCount: 40 }), TODAY);
    expect(v.progressPct).toBe(100);
    expect(v.progressLabel).toBe("30/30");
    expect(v.badgeText).toBe("完賽");
  });
  test("尚未開賽：DAY 0 → badge + 報名日（C2）", () => {
    const v = cardViewModel(makeSeries({ dayCount: 0, articleCount: 0, articles: [] }), TODAY);
    expect(v.badgeText).toBe("尚未開賽");
    expect(v.badgeClass).toBe("day-badge day-badge--pending");
    expect(v.progressLabel).toBe("0/30");
    expect(v.progressPct).toBe(0);
    expect(v.chipText).toBe(""); // 無文章 → 無 chip
    expect(v.latest).toBeNull();
    expect(v.updatedIso).toBeNull();
    expect(v.emptySlotText).toBe("報名於 2026/08/01");
  });
  test("尚未開賽但無報名日 → 尚未開賽", () => {
    const v = cardViewModel(makeSeries({ dayCount: 0, articleCount: 0, articles: [], signupDate: "" }), TODAY);
    expect(v.emptySlotText).toBe("尚未開賽");
  });
  test("已刪文：DAY n 保留 + 文章已全數刪除", () => {
    const v = cardViewModel(makeSeries({ dayCount: 5, articleCount: 0, articles: [] }), TODAY);
    expect(v.badgeText).toBe("DAY 5");
    expect(v.badgeClass).toBe("day-badge day-badge--deleted");
    expect(v.chipText).toBe("已刪文");
    expect(v.chipClass).toBe("status-chip status-chip--deleted");
    expect(v.latest).toBeNull();
    expect(v.updatedIso).toBeNull();
    expect(v.emptySlotText).toBe("文章已全數刪除");
  });
});

describe("cardViewModel — chip 狀態", () => {
  test("昨日發文", () => {
    const s = makeSeries({
      articles: [{ id: 6, day: 6, title: "Day 6", url: "u", publishedAt: "2026-08-06T13:00:00+08:00", views: 1, likes: 0, comments: 0 }],
    });
    const v = cardViewModel(s, TODAY);
    expect(v.chipText).toBe("昨日發文");
    expect(v.chipClass).toBe("status-chip status-chip--yesterday");
  });
  test("停更中（2 天）", () => {
    const s = makeSeries({
      articles: [{ id: 5, day: 5, title: "Day 5", url: "u", publishedAt: "2026-08-05T13:00:00+08:00", views: 1, likes: 0, comments: 0 }],
    });
    const v = cardViewModel(s, TODAY);
    expect(v.chipText).toBe("停更中");
    expect(v.chipClass).toBe("status-chip status-chip--stale");
  });
  test("長時間停更（≥10 天）帶 tooltip 天數", () => {
    const s = makeSeries({
      articles: [{ id: 1, day: 1, title: "Day 1", url: "u", publishedAt: "2026-07-20T13:00:00+08:00", views: 1, likes: 0, comments: 0 }],
    });
    const v = cardViewModel(s, TODAY);
    expect(v.chipText).toBe("長時間停更");
    expect(v.chipClass).toBe("status-chip status-chip--long");
    expect(v.chipTitle).toBe("停更 18 天");
  });
  test("完賽優先於發文狀態", () => {
    // 最新文章已停更 20 天，但 DAY≥30 → chip 仍是「鐵人煉成」
    const s = makeSeries({ dayCount: 30, articleCount: 30, articles: [{ id: 30, day: 30, title: "D30", url: "u", publishedAt: "2026-07-18T13:00:00+08:00", views: 1, likes: 0, comments: 0 }] });
    expect(cardViewModel(s, TODAY).chipText).toBe("鐵人煉成");
  });
});

describe("cardViewModel — 資料欄位", () => {
  test("URL 組裝", () => {
    const v = cardViewModel(makeSeries({}), TODAY);
    expect(v.seriesUrl).toBe("https://ithelp.ithome.com.tw/users/20118581/ironman/9034");
    expect(v.profileUrl).toBe("https://ithelp.ithome.com.tw/users/20118581");
    expect(v.rssUrl).toBe("https://ithelp.ithome.com.tw/rss/series/9034");
  });
  test("latest = 最後一篇文章；updatedIso 同步", () => {
    const v = cardViewModel(makeSeries({}), TODAY);
    expect(v.latest?.title).toBe("Day 7");
    expect(v.latest?.views).toBe(99);
    expect(v.updatedIso).toBe("2026-08-07T13:00:00+08:00");
  });
  test("totalViews 無 sumViews → articles 求和", () => {
    const s = makeSeries({});
    expect(totalViewsOf(s)).toBe(109); // 10 + 99
    expect(cardViewModel(s, TODAY).totalViews).toBe(109);
  });
  test("sumViews 優先（client compact 資料）", () => {
    expect(totalViewsOf(makeSeries({ sumViews: 999 }))).toBe(999);
    expect(cardViewModel(makeSeries({ sumViews: 999 }), TODAY).totalViews).toBe(999);
  });
});

describe("signupDateText", () => {
  test("標準格式 → YYYY/MM/DD", () => {
    expect(signupDateText("2026/08/01T12:07:01+08:00")).toBe("2026/08/01");
  });
  test("空字串 / 缺陷格式 → null", () => {
    expect(signupDateText("")).toBeNull();
    expect(signupDateText("bad")).toBeNull();
    expect(signupDateText("2026/8/1T12:00:00+08:00")).toBeNull(); // 非補零格式不在白名單
  });
  test("橫線格式（測試 fixture 用過）也接受", () => {
    expect(signupDateText("2026-08-01T00:00:00+08:00")).toBe("2026-08-01");
  });
});

describe("chipClassOf", () => {
  test("各狀態 class 對應", () => {
    expect(chipClassOf({ kind: "today" })).toBe("status-chip");
    expect(chipClassOf({ kind: "yesterday" })).toBe("status-chip status-chip--yesterday");
    expect(chipClassOf({ kind: "stale", days: 2 })).toBe("status-chip status-chip--stale");
    expect(chipClassOf({ kind: "long-stale", days: 18 })).toBe("status-chip status-chip--long");
    expect(chipClassOf({ kind: "done" })).toBe("status-chip status-chip--done");
    expect(chipClassOf({ kind: "deleted" })).toBe("status-chip status-chip--deleted");
    expect(chipClassOf(null)).toBe("");
  });
});
