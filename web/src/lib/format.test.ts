import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isoInitial, tzTime } from "./format";

// ── isoInitial：ISO → `YYYY-MM-DD HH:mm`（無秒、無 offset）──────────────────
describe("isoInitial", () => {
  test("T 分隔 ISO → 空格分隔、截到分鐘", () => {
    expect(isoInitial("2026-08-06T20:21:06+08:00")).toBe("2026-08-06 20:21");
  });
  test("空格分隔 ISO（updatedAt 格式）→ 同樣截到分鐘", () => {
    expect(isoInitial("2026-08-11 13:53:49+08:00")).toBe("2026-08-11 13:53");
  });
  test("null / undefined / 空字串 → 空字串（SSR 可選欄位）", () => {
    expect(isoInitial(null)).toBe("");
    expect(isoInitial(undefined)).toBe("");
    expect(isoInitial("")).toBe("");
  });
});

// ── tzTime：絕對時間固定顯示臺北牆鐘，相對時間以本地 now 計算 ───────────────
// 測試時對 Date.now 打樁，讓「相對時間」分支可確定（不依賴執行時點）。
describe("tzTime", () => {
  const realNow = Date.now;
  const fixedNow = Date.parse("2026-08-11T06:00:00Z"); // 臺北 14:00
  beforeEach(() => { Date.now = () => fixedNow; });
  afterEach(() => { Date.now = realNow; });

  test("abs 固定為臺北牆鐘（非 UTC、非本地）", () => {
    const t = tzTime("2026-08-11T13:53:49+08:00"); // 13:53+08 = 05:53Z；臺北牆鐘即 13:53
    expect(t.abs).toContain("13:53");
  });

  test("相對時間：60 秒內 → 剛剛", () => {
    expect(tzTime("2026-08-11T13:59:30+08:00").rel).toBe("剛剛"); // = 05:59:30Z，30 秒前
  });
  test("相對時間：分 / 小時", () => {
    expect(tzTime("2026-08-11T13:00:00+08:00").rel).toBe("1 小時前"); // = 05:00Z，1 小時前
    expect(tzTime("2026-08-11T05:00:00+08:00").rel).toBe("9 小時前"); // = 前一天 21:00Z
  });
  test("相對時間：昨天 / 超過兩天回退絕對", () => {
    expect(tzTime("2026-08-10T14:00:00+08:00").rel).toBe("昨天"); // = 前一天 06:00Z，24h
    expect(tzTime("2026-08-09T15:00:00+08:00").rel).toBe("昨天"); // = 兩天前 07:00Z，< 48h（47h）
    expect(tzTime("2026-08-09T14:00:00+08:00").rel).toMatch(/\d{2}\/\d{2}/); // = 剛好 48h，回退絕對
    expect(tzTime("2026-08-08T14:00:00+08:00").rel).toMatch(/\d{2}\/\d{2}/); // 三天前 → abs
  });
});
