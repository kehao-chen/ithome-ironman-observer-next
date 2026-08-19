// hall-of-fame-dom 結構契約測試。
// 目的：read-only 卡片骨架（class / 欄位順序 / 無 fav-RSS controls）在此鎖成契約；
// 顯示決定（badge/chip/瀏覽/最新）來自 card.ts view-model——此處不做第二套判定。
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Series } from "../../../scripts/types";
import { buildReadOnlyCard } from "./hall-of-fame-dom";

const win = new Window();
(globalThis as Record<string, unknown>).document = win.document;

function sampleSeries(): Series {
  return {
    id: 9128,
    user: { id: 20065770, name: "高見龍", profileUrl: "https://ithelp.ithome.com.tw/users/20065770/profile" },
    group: "Software Development",
    title: "為你自己手刻 Claude Code",
    description: "",
    team: null,
    signupDate: "2026/08/01T00:00:00+08:00",
    lastUpdated: null,
    dayCount: 15,
    articleCount: 15,
    subscriptions: 0,
    articles: [{ id: 1, day: 15, title: "Day 15", url: "https://ithelp.ithome.com.tw/articles/1", publishedAt: "2026-08-19T10:00:00+08:00", views: 500, likes: 0, comments: 0 }],
  };
}

describe("buildReadOnlyCard", () => {
  test("骨架與 buildCard 一致（badge/chip/progress/title/meta/latest/stat）", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    expect(el.className).toBe("series-card");
    expect(el.querySelector(".card-head")).not.toBeNull();
    expect(el.querySelector(".progress")).not.toBeNull();
    expect(el.querySelector(".card-title")).not.toBeNull();
    expect(el.querySelector(".meta")).not.toBeNull();
    expect(el.querySelector(".latest")).not.toBeNull();
    expect(el.querySelector(".card-stat")).not.toBeNull();
    expect(el.querySelector(".card-stat")!.textContent).toContain("瀏覽");
  });

  test("無收藏與 RSS 按鈕（dead controls 禁止）", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    expect(el.querySelector(".card-fav")).toBeNull();
    expect(el.querySelector("[data-rss]")).toBeNull();
    expect(el.querySelectorAll(".card-action")).toHaveLength(0);
  });

  test("profile 連結為完整絕對 URL", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    const au = el.querySelector<HTMLAnchorElement>(".meta-author")!;
    expect(au.href).toBe("https://ithelp.ithome.com.tw/users/20065770");
    expect(au.textContent).toBe("高見龍");
  });

  test("無文章系列顯示 emptySlotText", () => {
    const s = { ...sampleSeries(), articles: [], articleCount: 0, dayCount: 0 };
    const el = buildReadOnlyCard(s, "2026-08-19");
    const latest = el.querySelector(".latest-link")!;
    expect(latest.textContent).not.toBe("");
  });

  test("updatedIso 存在時輸出 .updated time", () => {
    const el = buildReadOnlyCard(sampleSeries(), "2026-08-19");
    const upd = el.querySelector(".updated time");
    expect(upd).not.toBeNull();
    expect(upd!.getAttribute("datetime")).toBe("2026-08-19T10:00:00+08:00");
  });

  test("不安全 URL → 不產生 href（純文字）", () => {
    // unsafe 值放 articles[0].url（唯一可由外部資料進入 view-model 的 URL 槽位）：
    // profileUrl 由 cardViewModel 以 user.id 組出（恆安全），非測試此防線的標的。
    const s = {
      ...sampleSeries(),
      articles: [{ id: 1, day: 15, title: "Day 15", url: "javascript:alert(1)", publishedAt: "2026-08-19T10:00:00+08:00", views: 500, likes: 0, comments: 0 }],
    };
    const el = buildReadOnlyCard(s, "2026-08-19");
    // 無任何 a[href] 是 javascript: 或空 href
    el.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      expect(a.href.startsWith("javascript:")).toBe(false);
      expect(a.getAttribute("href")).not.toBe("");
    });
    // latest-link 改純文字 span（非 a）
    const latest = el.querySelector(".latest-link")!;
    expect(latest.tagName).not.toBe("A");
    expect(latest.textContent).toContain("Day 15");
  });
});
