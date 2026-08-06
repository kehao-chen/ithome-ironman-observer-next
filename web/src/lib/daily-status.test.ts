import { describe, expect, test } from "bun:test";
import { isDeletedSeries, stalenessDays, statusChip, statusChipText, statusChipTitle, taipeiDay, taipeiToday } from "./daily-status";

describe("taipeiDay", () => {
  test("取 +08:00 ISO 的臺北日曆日", () => {
    expect(taipeiDay("2026-08-05T07:14:15+08:00")).toBe("2026-08-05");
  });
  test("空白分隔（updatedAt 格式）也取前 10 字元", () => {
    expect(taipeiDay("2026-08-05 20:50:57+08:00")).toBe("2026-08-05");
  });
  test("null / undefined（無文章）回傳空字串", () => {
    expect(taipeiDay(null)).toBe("");
    expect(taipeiDay(undefined)).toBe("");
  });
});

describe("taipeiToday", () => {
  test("格式為 YYYY-MM-DD", () => {
    expect(taipeiToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isDeletedSeries", () => {
  test("dayCount>0 且 articleCount=0 → 已刪文", () => {
    expect(isDeletedSeries(4, 0)).toBe(true);
    expect(isDeletedSeries(30, 0)).toBe(true);
  });
  test("未開賽（dayCount=0, articleCount=0）→ 非刪文", () => {
    expect(isDeletedSeries(0, 0)).toBe(false);
  });
  test("正常系列（articleCount>0）→ 非刪文", () => {
    expect(isDeletedSeries(1, 1)).toBe(false);
    expect(isDeletedSeries(0, 0)).toBe(false);
    expect(isDeletedSeries(30, 30)).toBe(false);
  });
});

describe("stalenessDays", () => {
  test("今天=0、昨天=1、前天=2", () => {
    const today = "2026-08-05";
    expect(stalenessDays("2026-08-05T07:14:15+08:00", today)).toBe(0);
    expect(stalenessDays("2026-08-04T07:14:15+08:00", today)).toBe(1);
    expect(stalenessDays("2026-08-03T07:14:15+08:00", today)).toBe(2);
  });
  test("跨月邊界", () => {
    expect(stalenessDays("2026-07-31T23:59:59+08:00", "2026-08-01")).toBe(1);
    expect(stalenessDays("2026-12-31T00:00:00+08:00", "2027-01-02")).toBe(2);
  });
  test("無文章（null/undefined）回傳 null", () => {
    expect(stalenessDays(null, "2026-08-05")).toBeNull();
    expect(stalenessDays(undefined, "2026-08-05")).toBeNull();
  });
  test("malformed 日期回傳 null", () => {
    expect(stalenessDays("not-a-date", "2026-08-05")).toBeNull();
    expect(stalenessDays("2026-8-5T07:14:15+08:00", "2026-08-05")).toBeNull();
  });
  test("未來日期（負差）回傳 null", () => {
    expect(stalenessDays("2026-08-06T00:00:00+08:00", "2026-08-05")).toBeNull();
  });
});

describe("statusChip", () => {
  const today = "2026-08-05";
  test("今日發文 → today", () => {
    expect(statusChip("2026-08-05T07:14:15+08:00", 7, today, 7)).toEqual({ kind: "today" });
  });
  test("昨日發文（N=1）→ yesterday", () => {
    expect(statusChip("2026-08-04T07:14:15+08:00", 7, today, 7)).toEqual({ kind: "yesterday" });
  });
  test("停更 2~9 天 → stale", () => {
    expect(statusChip("2026-08-03T07:14:15+08:00", 7, today, 7)).toEqual({ kind: "stale", days: 2 });
    expect(statusChip("2026-07-27T07:14:15+08:00", 7, today, 7)).toEqual({ kind: "stale", days: 9 });
  });
  test("停更 ≥10 天 → long-stale", () => {
    expect(statusChip("2026-07-26T07:14:15+08:00", 7, today, 7)).toEqual({ kind: "long-stale", days: 10 });
    expect(statusChip("2026-06-01T07:14:15+08:00", 7, today, 7)).toEqual({ kind: "long-stale", days: 65 });
  });
  test("無文章 → 不顯示", () => {
    expect(statusChip(null, 0, today, 0)).toBeNull();
  });
  test("已刪文（dayCount>0 且 articleCount=0）→ deleted，優先於其他狀態", () => {
    // 案例：Day 4 後刪光文章 — RSS 無 items，publishedAt 為 null
    expect(statusChip(null, 4, today, 0)).toEqual({ kind: "deleted" });
    // 就算有殘留 lastUpdated（stale 判定素材），也必須是 deleted
    expect(statusChip("2026-08-01T07:14:15+08:00", 4, today, 0)).toEqual({ kind: "deleted" });
    // 完賽系列刪文 → deleted（優先於 done）
    expect(statusChip("2026-08-05T07:14:15+08:00", 30, today, 0)).toEqual({ kind: "deleted" });
  });
  test("未開賽（dayCount=0, articleCount=0）→ 不顯示（非刪文）", () => {
    expect(statusChip(null, 0, today, 0)).toBeNull();
  });
  test("完賽（dayCount≥30）→ done（優先於發文狀態）", () => {
    expect(statusChip("2026-08-04T07:14:15+08:00", 30, today, 30)).toEqual({ kind: "done" }); // 昨日發文
    expect(statusChip("2026-08-05T07:14:15+08:00", 30, today, 30)).toEqual({ kind: "done" }); // 今日發文
    expect(statusChip("2026-07-01T07:14:15+08:00", 30, today, 30)).toEqual({ kind: "done" }); // 久未發文
    expect(statusChip(null, 32, today, 32)).toEqual({ kind: "done" }); // 無文章但已完賽
  });
  test("malformed 日期 → 不顯示", () => {
    expect(statusChip("garbage", 7, today, 7)).toBeNull();
  });
});

describe("statusChipText", () => {
  test("固定詞文案（寬度穩定）", () => {
    expect(statusChipText({ kind: "today" })).toBe("今日發文");
    expect(statusChipText({ kind: "yesterday" })).toBe("昨日發文");
    expect(statusChipText({ kind: "stale", days: 3 })).toBe("停更中");
    expect(statusChipText({ kind: "long-stale", days: 12 })).toBe("長時間停更");
    expect(statusChipText({ kind: "done" })).toBe("鐵人煉成");
    expect(statusChipText({ kind: "deleted" })).toBe("已刪文");
    expect(statusChipText(null)).toBe("");
  });
});

describe("statusChipTitle", () => {
  test("stale / long-stale 帶天數 tooltip", () => {
    expect(statusChipTitle({ kind: "stale", days: 3 })).toBe("停更 3 天");
    expect(statusChipTitle({ kind: "long-stale", days: 12 })).toBe("停更 12 天");
  });
  test("today / yesterday / done / deleted / null 無 tooltip", () => {
    expect(statusChipTitle({ kind: "today" })).toBeNull();
    expect(statusChipTitle({ kind: "yesterday" })).toBeNull();
    expect(statusChipTitle({ kind: "done" })).toBeNull();
    expect(statusChipTitle({ kind: "deleted" })).toBeNull();
    expect(statusChipTitle(null)).toBeNull();
  });
});
