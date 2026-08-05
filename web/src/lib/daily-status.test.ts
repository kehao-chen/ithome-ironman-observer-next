import { describe, expect, test } from "bun:test";
import { stalenessDays, statusChip, statusChipText, taipeiDay, taipeiToday } from "./daily-status";

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
    expect(statusChip("2026-08-05T07:14:15+08:00", 7, today)).toEqual({ kind: "today" });
  });
  test("昨天發文（N=1）→ 不顯示", () => {
    expect(statusChip("2026-08-04T07:14:15+08:00", 7, today)).toBeNull();
  });
  test("前天發文（N=2）→ 停更 2 天", () => {
    expect(statusChip("2026-08-03T07:14:15+08:00", 7, today)).toEqual({ kind: "stale", days: 2 });
  });
  test("無文章 → 不顯示", () => {
    expect(statusChip(null, 0, today)).toBeNull();
  });
  test("完賽且昨天發文 → 不顯示（停更非異常）", () => {
    expect(statusChip("2026-08-04T07:14:15+08:00", 30, today)).toBeNull();
  });
  test("完賽且今天發文 → 今日發文", () => {
    expect(statusChip("2026-08-05T07:14:15+08:00", 30, today)).toEqual({ kind: "today" });
  });
  test("malformed 日期 → 不顯示", () => {
    expect(statusChip("garbage", 7, today)).toBeNull();
  });
});

describe("statusChipText", () => {
  test("today / stale / null 文案", () => {
    expect(statusChipText({ kind: "today" })).toBe("今日發文");
    expect(statusChipText({ kind: "stale", days: 3 })).toBe("停更 3 天");
    expect(statusChipText(null)).toBe("");
  });
});
