import { describe, expect, test } from "bun:test";
import { normalize, seriesMatchesQuery } from "./search";
import type { Series } from "../../../scripts/types";

describe("normalize", () => {
  test("全形→半形（字母、數字、空格）", () => {
    expect(normalize("ＶＵＥ")).toBe("vue");
    expect(normalize("２０２６")).toBe("2026");
    expect(normalize("ｖｕｅ 前端")).toBe("vue前端");
  });
  test("大小寫歸一", () => {
    expect(normalize("Vue")).toBe("vue");
    expect(normalize("VUE")).toBe("vue");
  });
  test("前後空白與內部空白移除", () => {
    expect(normalize("  VUE  ")).toBe("vue");
    expect(normalize("V u e")).toBe("vue");
    expect(normalize("vue\t前端")).toBe("vue前端");
  });
  test("繁中原文保留（不轉換）", () => {
    expect(normalize("前端")).toBe("前端");
    expect(normalize("鐵人賽")).toBe("鐵人賽");
  });
  test("全形中文標點收斂成對應半形（U+FF0C → ,）", () => {
    expect(normalize("前端，你好")).toBe("前端,你好");
  });
});

function makeSeries(partial: Partial<Series>): Series {
  const base: Series = {
    id: 1,
    user: { id: 1, name: "小明", profileUrl: "https://ithelp.ithome.com.tw/users/1" },
    group: "Modern Web",
    title: "Vue 前端開發",
    description: "",
    team: null,
    signupDate: "2026-01-01",
    lastUpdated: null,
    dayCount: 7,
    articleCount: 7,
    subscriptions: 10,
    articles: [],
  };
  return { ...base, ...partial };
}

describe("seriesMatchesQuery", () => {
  const s = makeSeries({});

  test("空 query → true（搜尋關閉）", () => {
    expect(seriesMatchesQuery(s, "")).toBe(true);
  });
  test("全空白 query → true（filter(Boolean) 後無 token）", () => {
    expect(seriesMatchesQuery(s, "   ")).toBe(true);
    expect(seriesMatchesQuery(s, "　　")).toBe(true);
    expect(seriesMatchesQuery(s, " \t ")).toBe(true);
  });
  test("標題命中", () => {
    expect(seriesMatchesQuery(s, "vue")).toBe(true);
    expect(seriesMatchesQuery(s, "前端")).toBe(true);
  });
  test("作者名命中", () => {
    expect(seriesMatchesQuery(s, "小明")).toBe(true);
  });
  test("組別命中", () => {
    expect(seriesMatchesQuery(s, "modern")).toBe(true);
  });
  test("team 命中（team 非 null 時）", () => {
    expect(seriesMatchesQuery(makeSeries({ team: "DevOps 戰隊" }), "戰隊")).toBe(true);
  });
  test("team: null 安全——不 throw、不命中", () => {
    expect(seriesMatchesQuery(s, "戰隊")).toBe(false);
  });
  test("大小寫不敏感", () => {
    expect(seriesMatchesQuery(s, "VUE")).toBe(true);
  });
  test("全形 query 命中半形資料（normalize 對稱性）", () => {
    expect(seriesMatchesQuery(s, "ＶＵＥ")).toBe(true);
  });
  test("token AND：全部 token 命中才列入", () => {
    expect(seriesMatchesQuery(s, "vue 小明")).toBe(true); // 標題含 vue、作者含 小明
    expect(seriesMatchesQuery(s, "vue 不存在")).toBe(false);
    expect(seriesMatchesQuery(s, "vue 前端 小明")).toBe(true);
    expect(seriesMatchesQuery(s, "vue 前端 不存在")).toBe(false);
  });
  test("全形空格分隔 token 照常 AND", () => {
    expect(seriesMatchesQuery(s, "vue　小明")).toBe(true);
    expect(seriesMatchesQuery(s, "vue　不存在")).toBe(false);
  });
  test("無命中回 false", () => {
    expect(seriesMatchesQuery(s, "區塊鏈")).toBe(false);
  });
});
