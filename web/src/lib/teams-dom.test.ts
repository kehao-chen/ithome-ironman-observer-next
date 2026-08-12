// teams-dom 結構契約測試。
// 目的：榜單列的 DOM 骨架（class / data-* / 展開 toggle）在此鎖成契約；
// 顯示決定（警示摘要文字、狀態 chip）來自 teams.ts / daily-status.ts / card.ts view-model，
// 此處不做第二套判定——成員 chip 由 cardViewModel + buildChip 產生（與主卡片同一來源）。
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Series } from "../../../scripts/types";
import { buildTeamRow } from "./teams-dom";
import { statusChipText } from "./daily-status";
import type { TeamMemberRow, TeamRow } from "./teams";

// teams-dom 的 DOM 建構使用全域 document——用 happy-dom 注入（無 module-load 副作用，呼叫時才需要）。
const win = new Window();
(globalThis as Record<string, unknown>).document = win.document;

const TODAY = "2026-08-11";

// 真實 series fixture（mirror card-dom.test.ts 的 makeSeries base）——
// buildMemberRow 會呼叫 cardViewModel(m.series, today) 存取 dayCount/articleCount/articles/user/group，
// 不能用空物件佔位，否則 runtime crash。
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

// 今日發文成員（最新文章 = TODAY）→ chip「今日發文」、progressLabel「9/30」。
const memberToday: TeamMemberRow = {
  series: makeSeries({
    id: 1001,
    user: { id: 20118581, name: "SQLMASTER", profileUrl: "https://ithelp.ithome.com.tw/users/20118581" },
    dayCount: 9,
    articleCount: 9,
    articles: [
      { id: 9, day: 9, title: "Day 9", url: "https://ithelp.ithome.com.tw/articles/9", publishedAt: "2026-08-11T12:00:00+08:00", views: 832, likes: 0, comments: 0 },
    ],
  }),
  views: 832,
  status: { kind: "today" },
  staleDays: 0,
  isPending: false,
};

// 停更成員（最新文章 = 3 天前）→ chip「停更中」、progressLabel「5/30」。
const memberStale: TeamMemberRow = {
  series: makeSeries({
    id: 1002,
    user: { id: 20118582, name: "JS達人", profileUrl: "https://ithelp.ithome.com.tw/users/20118582" },
    title: "JS 深入淺出",
    dayCount: 5,
    articleCount: 5,
    articles: [
      { id: 5, day: 5, title: "Day 5", url: "https://ithelp.ithome.com.tw/articles/5", publishedAt: "2026-08-08T12:00:00+08:00", views: 1059, likes: 0, comments: 0 },
    ],
  }),
  views: 1059,
  status: { kind: "stale", days: 3 },
  staleDays: 3,
  isPending: false,
};

function makeRow(partial: Partial<TeamRow> = {}): TeamRow {
  return {
    name: "五人成行，Bug 不行",
    members: [memberToday, memberStale],
    memberCount: 2,
    totalViews: 1891,
    avgViews: 945,
    avgProgress: 9,
    postedToday: 1,
    staleCount: 1,
    pendingCount: 0,
    alertSummary: "今日缺發 1 人 · 停更 1 人",
    hasAlert: true,
    ...partial,
  };
}

describe("buildTeamRow", () => {
  test("骨架：團隊名 + 成員數 + 四欄位 + 警示摘要 + 警示色 class", () => {
    const el = buildTeamRow(makeRow(), TODAY);
    expect(el.classList.contains("team-row")).toBe(true);
    expect(el.dataset.teamName).toBe("五人成行，Bug 不行");
    expect(el.classList.contains("team-row--alert")).toBe(true);
    const text = el.textContent ?? "";
    expect(text).toContain("五人成行，Bug 不行");
    expect(text).toContain("2");          // 成員數
    expect(text).toContain("1,891");      // 總瀏覽 toLocaleString
    expect(text).toContain("945");        // 人均
    expect(text).toContain("9");          // 平均進度
    expect(text).toContain("1/2");        // 今日發文
    expect(text).toContain("今日缺發 1 人 · 停更 1 人");
  });
  test("健康列不加警示色、無摘要", () => {
    // 全員健康（今日發文）→ 無警示摘要、無警示色、無警示相關文字。
    const el = buildTeamRow(
      makeRow({ alertSummary: null, hasAlert: false, members: [memberToday, memberToday] }),
      TODAY,
    );
    expect(el.classList.contains("team-row--alert")).toBe(false);
    expect(el.querySelector(".team-alert")).toBeNull();
    expect(el.textContent).not.toContain("停更");
    expect(el.textContent).not.toContain("今日缺發");
  });
  test("展開區初始 hidden、含成員列與看該隊系列", () => {
    const el = buildTeamRow(makeRow(), TODAY);
    const body = el.querySelector<HTMLElement>(".team-body");
    expect(body).not.toBeNull();
    expect(body?.hidden).toBe(true);
    const memberRows = el.querySelectorAll(".team-member");
    expect(memberRows).toHaveLength(2);
    // 每位成員列：作者連結（cardViewModel 的 profileUrl）+ 組別·進度 + 瀏覽 + 狀態 chip
    const nameLink = el.querySelector<HTMLAnchorElement>(".team-member-name");
    expect(nameLink?.getAttribute("href")).toBe("https://ithelp.ithome.com.tw/users/20118581");
    expect(nameLink?.textContent).toBe("SQLMASTER");
    expect(el.textContent).toContain("自我挑戰組 · 9/30");
    expect(el.textContent).toContain("自我挑戰組 · 5/30");
    expect(el.textContent).toContain("832 瀏覽");
    expect(el.textContent).toContain("1,059 瀏覽");
    // 狀態 chip 文字由 cardViewModel（同 statusChipText）決定——非手寫分支
    expect(el.textContent).toContain(statusChipText({ kind: "today" }));
    expect(el.textContent).toContain(statusChipText({ kind: "stale", days: 3 }));
    // .team-go 才是「看該隊系列」按鈕（row root 也有 data-team-name，不能拿 root 冒充按鈕）。
    const goBtn = el.querySelector<HTMLElement>(".team-go");
    expect(goBtn?.textContent).toContain("看該隊系列");
    expect(goBtn?.dataset.teamName).toBe("五人成行，Bug 不行");
  });
  test("展開 toggle：aria-expanded 初始 false", () => {
    const el = buildTeamRow(makeRow(), TODAY);
    const toggle = el.querySelector<HTMLElement>("[data-expand]");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });
});
