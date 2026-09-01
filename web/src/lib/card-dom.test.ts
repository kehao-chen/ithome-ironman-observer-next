// card-dom 結構契約測試。
// 目的：client（buildCard/buildRow）與 SSR（SeriesCard.astro）共用同一 cardViewModel，
// 但 DOM 骨架（元素順序 / class / data-*）是各自寫的——這裡把骨架鎖成契約。
// 改 SeriesCard.astro 的結構時，必須同步改 card-dom.ts 與本測試（反之亦然）。
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Series, YearData } from "../../../scripts/types";
import { buildCard, buildRow } from "./card-dom";
import { cardViewModel } from "./card";
import realData from "../../../data/2026.json";

// card-dom 的 DOM 建構使用全域 document——用 happy-dom 注入（無 module-load 副作用，呼叫時才需要）。
const win = new Window();
(globalThis as Record<string, unknown>).document = win.document;

const TODAY = "2026-08-07";

function makeSeries(partial: Partial<Series> & { sumViews?: number }): Series & { sumViews?: number } {
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

describe("buildCard — 結構契約（mirror SeriesCard.astro）", () => {
  test("進行中系列：完整骨架 + 元素順序（stat → fav → rss）", () => {
    const card = buildCard(makeSeries({}), TODAY, false);
    expect(card.className).toBe("series-card");

    // head：head-left（badge + chip）→ head-right（stat + fav + rss）
    const head = card.querySelector(".card-head")!;
    expect([...head.children].map((c) => c.className)).toEqual(["card-head-left", "card-head-right"]);
    const headLeft = head.querySelector(".card-head-left")!;
    expect([...headLeft.children].map((c) => c.className)).toEqual(["day-badge", "status-chip"]);
    expect(headLeft.children[0].textContent).toBe("DAY 7");
    expect(headLeft.children[1].textContent).toBe("今日發文");

    // 順序契約：與 SeriesCard.astro 的 <span stat><button fav><button rss> 相同
    const headRight = head.querySelector(".card-head-right")!;
    expect([...headRight.children].map((c) => c.className)).toEqual([
      "card-stat tabular-nums",
      "card-action card-fav",
      "card-action",
    ]);
    expect(headRight.querySelector<HTMLElement>(".card-stat")!.textContent).toBe("109 瀏覽");
    const fav = headRight.querySelector<HTMLElement>(".card-fav")!;
    expect(fav.getAttribute("aria-pressed")).toBe("false");
    expect(fav.dataset.favId).toBe("9034");
    expect(headRight.querySelector<HTMLElement>("[data-rss]")!.dataset.rss).toBe("https://ithelp.ithome.com.tw/rss/series/9034");

    // progress：fill + label
    const fill = card.querySelector<HTMLElement>(".progress-fill")!;
    expect(fill.style.width).toBe("23.333333333333332%");
    expect(card.querySelector(".progress-label")!.textContent).toBe("7/30");

    // title / meta
    expect(card.querySelector<HTMLAnchorElement>(".card-title a")!.href).toBe("https://ithelp.ithome.com.tw/users/20118581/ironman/9034");
    expect(card.querySelector(".card-title a")!.textContent).toBe("SQL Server 基礎&調教");
    expect(card.querySelector<HTMLAnchorElement>(".meta-author")!.href).toBe("https://ithelp.ithome.com.tw/users/20118581");
    expect(card.querySelector(".meta")!.textContent).toContain("自我挑戰組");

    // latest：tag + link + 當篇觀看
    expect(card.querySelector(".latest-tag")!.textContent).toBe("最新");
    expect(card.querySelector<HTMLAnchorElement>(".latest-link")!.href).toBe("https://ithelp.ithome.com.tw/articles/7");
    expect(card.querySelector(".latest-link")!.textContent).toContain("Day 7");
    expect(card.querySelector(".latest-views")!.textContent).toContain("99 當篇觀看");

    // updated：time datetime = publishedAt
    const time = card.querySelector<HTMLTimeElement>(".updated time")!;
    expect(time.dateTime).toBe("2026-08-07T13:00:00+08:00");
  });

  test("已收藏：aria-pressed=true + 取消收藏 label", () => {
    const fav = buildCard(makeSeries({}), TODAY, true).querySelector<HTMLElement>(".card-fav")!;
    expect(fav.getAttribute("aria-pressed")).toBe("true");
    expect(fav.getAttribute("aria-label")).toBe("取消收藏");
  });

  test("尚未開賽：報名後天數 + 無 chip + 0/30 + 無 updated", () => {
    const card = buildCard(makeSeries({ dayCount: 0, articleCount: 0, articles: [] }), TODAY, false);
    expect(card.querySelector(".day-badge")!.textContent).toBe("尚未開賽");
    expect(card.querySelector(".status-chip")).toBeNull();
    expect(card.querySelector(".progress-label")!.textContent).toBe("0/30");
    expect(card.querySelector<HTMLElement>(".progress-fill")!.style.width).toBe("0%");
    expect(card.querySelector(".latest-link")!.textContent).toBe("尚未開賽（已報名 6 天）");
    expect(card.querySelector(".updated")).toBeNull();
  });

  test("已刪文：DAY n 保留 + 文章已全數刪除", () => {
    const card = buildCard(makeSeries({ dayCount: 5, articleCount: 0, articles: [] }), TODAY, false);
    expect(card.querySelector(".day-badge")!.textContent).toBe("DAY 5");
    expect(card.querySelector(".status-chip")!.textContent).toBe("已刪文");
    expect(card.querySelector(".latest-link")!.textContent).toBe("文章已全數刪除");
  });

  test("完賽：滿條 + 30/30 + 鐵人煉成", () => {
    const card = buildCard(makeSeries({ dayCount: 30, articleCount: 30 }), TODAY, false);
    expect(card.querySelector(".day-badge")!.textContent).toBe("完賽");
    expect(card.querySelector(".progress-fill")!.className).toContain("progress-fill--done");
    expect(card.querySelector<HTMLElement>(".progress-fill")!.style.width).toBe("100%");
    expect(card.querySelector(".progress-label")!.textContent).toBe("30/30");
    expect(card.querySelector(".status-chip")!.textContent).toBe("鐵人煉成");
  });
});

describe("buildRow — 結構契約", () => {
  test("row-left → row-main → row-views → row-actions", () => {
    const row = buildRow(makeSeries({}), TODAY, true);
    expect(row.className).toBe("series-row");
    expect([...row.children].map((c) => c.className)).toEqual([
      "row-left",
      "row-main",
      "row-views tabular-nums",
      "row-actions",
    ]);
    const left = row.querySelector(".row-left")!;
    expect([...left.children].map((c) => c.className)).toEqual(["day-badge", "status-chip"]);
    expect(row.querySelector(".row-views")!.textContent).toBe("109");
    const actions = row.querySelector(".row-actions")!;
    expect([...actions.children].map((c) => c.className)).toEqual(["card-action card-fav", "card-action", "card-action"]);
    expect(actions.querySelector<HTMLElement>(".card-fav")!.getAttribute("aria-pressed")).toBe("true");
    expect(actions.querySelector("[data-rss]")).not.toBeNull();
    expect(actions.querySelector("a")).not.toBeNull(); // 開啟系列
  });
});

describe("真實資料全量 sweep（data/2026.json）", () => {
  const data = realData as unknown as YearData;

  test(`全部 ${data.series.length} 支系列可建卡，emptySlot 文字與 view-model 一致`, () => {
    let pendingTexts = 0;
    let deletedTexts = 0;
    let expectedPending = 0;
    let expectedDeleted = 0;

    for (const s of data.series) {
      const v = cardViewModel(s, TODAY);
      const card = buildCard(s, TODAY, false);
      const row = buildRow(s, TODAY, false);
      // 標題、作者、進度、URL 有帶進 DOM
      expect(card.querySelector(".card-title a")!.textContent).toBe(s.title);
      expect(row.querySelector(".row-title")!.textContent).toBe(s.title);
      expect(card.querySelector<HTMLElement>(".card-stat")!.textContent).toBe(`${v.totalViews.toLocaleString()} 瀏覽`);
      expect(card.querySelector(".progress-label")!.textContent).toBe(v.progressLabel);
      if (v.latest) {
        expect(card.querySelector(".updated time")).not.toBeNull();
      } else {
        const emptyText = card.querySelector(".latest .latest-link")!.textContent ?? "";
        if (emptyText.startsWith("尚未開賽")) pendingTexts++;
        if (emptyText === "文章已全數刪除") deletedTexts++;
        if (v.emptySlotText.startsWith("尚未開賽")) expectedPending++;
        if (v.emptySlotText === "文章已全數刪除") expectedDeleted++;
      }
    }

    // builder 呈現的 emptySlot 計數 = view-model 的期望（資料與渲染一致）。
    // 注意：不做絕對數量斷言——賽事開跑後未開賽會歸零、已刪文系列也可能復原，
    // 自洽性（資料裡有 N 支就渲染出 N 支）才是這個測試要守的契約。
    expect(pendingTexts).toBe(expectedPending);
    expect(deletedTexts).toBe(expectedDeleted);
  });
});

// card-dom.test.ts 只鎖 client 側結構；這裡直接讀 SSR 模板 + view-model 原始碼，
// 確保關鍵契約字串與順序仍存在——改 SeriesCard.astro / card.ts 時必須同步改 card-dom.ts（反之亦然）。
// badge / chip / 進度的 class 不是模板字面值，而是 card.ts view-model 產生，故分開檢查。
const ssrTemplate = await Bun.file(`${import.meta.dir}/../components/SeriesCard.astro`).text();
const viewModelSrc = await Bun.file(`${import.meta.dir}/card.ts`).text();

describe("SSR 模板契約 tripwire", () => {
  test("SeriesCard.astro 結構 class 都存在（client 骨架 mirror 的來源）", () => {
    for (const cls of [
      "series-card", "card-head", "card-head-left", "card-head-right",
      "card-stat", "card-action card-fav", "progress", "progress-track",
      "progress-label", "card-title", "meta-author", "latest", "latest-link",
      "latest-tag", "latest-views", "updated", "muted",
    ]) {
      expect(ssrTemplate).toContain(cls);
    }
  });

  test("view-model（card.ts）提供 badge / chip / 進度 class 基底", () => {
    for (const cls of [
      "day-badge", "day-badge--deleted", "day-badge--done", "day-badge--pending",
      "status-chip", "status-chip--yesterday", "status-chip--done", "status-chip--deleted", "status-chip--long", "status-chip--stale",
      "progress-fill", "progress-fill--done", "progress-fill--pending",
    ]) {
      expect(viewModelSrc).toContain(cls);
    }
  });

  test("card-head-right 內順序：card-stat → card-fav → data-rss", () => {
    const right = ssrTemplate.indexOf("card-head-right");
    const stat = ssrTemplate.indexOf("card-stat", right);
    const fav = ssrTemplate.indexOf("card-fav", right);
    const rss = ssrTemplate.indexOf("data-rss", right);
    expect(stat).toBeGreaterThan(right);
    expect(fav).toBeGreaterThan(stat);
    expect(rss).toBeGreaterThan(fav);
  });

  test("模板使用 view-model 欄位（emptySlotText / updatedIso）", () => {
    expect(ssrTemplate).toContain("v.emptySlotText");
    expect(ssrTemplate).toContain("v.updatedIso");
  });
});
