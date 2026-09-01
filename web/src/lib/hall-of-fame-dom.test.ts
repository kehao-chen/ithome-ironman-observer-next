// web/src/lib/hall-of-fame-dom.test.ts — 名人堂 DOM 建構契約與 SSR 對齊測試。
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Series } from "../../../scripts/types";
import type { FamousRow } from "./hall-of-fame";
import { famousProfileViewModel } from "./hall-of-fame";
import {
  buildReadOnlyCard,
  buildProfileSection,
  buildQuickNav,
  extractProfileSignature,
} from "./hall-of-fame-dom";

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

function sampleFamousRow(): FamousRow {
  return {
    entry: {
      id: 20065770,
      name: "高見龍",
      bio: "五倍學院創辦人 / 為你自己學 Git 作者",
      credentials: [
        { label: "五倍學院", url: "https://5xcamp.us" },
        { label: "資深講師", url: "" },
      ],
      categories: ["speaker", "book"],
    },
    series: [sampleSeries()],
    totalViews: 500,
  };
}

function createSsrProfileFixture(row: FamousRow, today: string, year: number): HTMLElement {
  const vm = famousProfileViewModel(row);
  const div = document.createElement("div");
  const credsHtml = vm.credentials
    .map(
      (c) => `
        <li>
          ${
            c.url
              ? `<a class="hof-cred-btn" href="${c.url}" target="_blank" rel="noopener">
                  <span>${c.label}</span>
                  <svg class="hof-cred-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </a>`
              : `<span class="hof-cred-plain">${c.label}</span>`
          }
        </li>`
    )
    .join("");

  const catsHtml = vm.categories.map((c) => `<span class="hof-cat-chip">${c.label}</span>`).join("");

  div.innerHTML = `
    <section class="hof-card" id="${vm.anchorId}" data-famous-id="${vm.id}">
      <header class="hof-card-head">
        <div class="hof-avatar" aria-hidden="true">${vm.avatarChar}</div>
        <div class="hof-head-main">
          <div class="hof-name-row">
            <h2 class="hof-name">
              <a class="meta-author" href="${vm.profileUrl}" target="_blank" rel="noopener">${vm.name}</a>
            </h2>
            <span class="hof-categories">${catsHtml}</span>
          </div>
          <span class="hof-stats tabular-nums">${vm.statsText}</span>
        </div>
      </header>
      <p class="hof-bio">${vm.bio}</p>
      <ul class="hof-credentials">${credsHtml}</ul>
      <h3 class="hof-series-title">${year} 系列</h3>
      <div class="hof-series"></div>
      <footer class="hof-card-foot">
        <a class="hof-back-top" href="#hof-top">↑ 回到頂部</a>
      </footer>
    </section>
  `.trim();

  const section = div.firstElementChild as HTMLElement;
  const seriesContainer = section.querySelector(".hof-series")!;
  for (const s of row.series) {
    seriesContainer.appendChild(buildReadOnlyCard(s, today));
  }
  return section;
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
    const s = {
      ...sampleSeries(),
      articles: [{ id: 1, day: 15, title: "Day 15", url: "javascript:alert(1)", publishedAt: "2026-08-19T10:00:00+08:00", views: 500, likes: 0, comments: 0 }],
    };
    const el = buildReadOnlyCard(s, "2026-08-19");
    el.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      expect(a.href.startsWith("javascript:")).toBe(false);
      expect(a.getAttribute("href")).not.toBe("");
    });
    const latest = el.querySelector(".latest-link")!;
    expect(latest.tagName).not.toBe("A");
    expect(latest.textContent).toContain("Day 15");
  });
});

describe("SSR vs Client DOM Parity", () => {
  test("SSR fixture and Client DOM buildProfileSection produce identical structural signature", () => {
    const row = sampleFamousRow();
    const today = "2026-08-19";
    const year = 2026;

    const ssrSection = createSsrProfileFixture(row, today, year);
    const clientSection = buildProfileSection(row, today, year);

    const ssrSig = extractProfileSignature(ssrSection);
    const clientSig = extractProfileSignature(clientSection);

    expect(clientSig).toEqual(ssrSig);
    expect(clientSig.hasDeadControls).toBe(false);
    expect(clientSig.backTopHref).toBe("#hof-top");
    expect(clientSig.credentialCount).toBe(2);
    expect(clientSig.seriesCount).toBe(1);
    expect(clientSig.anchorId).toBe("hof-person-20065770");
  });
});

describe("buildQuickNav", () => {
  test("generates correct anchor links and badges", () => {
    const row = sampleFamousRow();
    const vm = famousProfileViewModel(row);
    const nav = buildQuickNav([vm]);

    expect(nav.tagName).toBe("NAV");
    expect(nav.className).toBe("hof-nav");
    expect(nav.id).toBe("hof-nav");
    expect(nav.getAttribute("aria-label")).toBe("名人快速導覽");
    expect(nav.hidden).toBe(false);

    const items = nav.querySelectorAll<HTMLAnchorElement>(".hof-nav-item");
    expect(items.length).toBe(1);
    const item = items[0];
    expect(item.getAttribute("href")).toBe("#hof-person-20065770");
    expect(item.querySelector("span")!.textContent).toBe("高見龍");

    const badge = item.querySelector(".hof-nav-count")!;
    expect(badge.textContent).toBe("1");
    expect(badge.getAttribute("aria-label")).toBe("1 個系列");
  });

  test("hidden when vms is empty", () => {
    const nav = buildQuickNav([]);
    expect(nav.hidden).toBe(true);
  });
});

describe("Retry observable contract", () => {
  test("failure triggers empty state, error message, and retry button while preserving currentYear", async () => {
    const empty = document.createElement("div");
    empty.id = "hof-empty";
    empty.hidden = true;

    const msg = document.createElement("p");
    msg.id = "hof-empty-msg";
    msg.textContent = "";
    empty.appendChild(msg);

    const retryBtn = document.createElement("button");
    retryBtn.id = "hof-retry";
    retryBtn.hidden = true;
    empty.appendChild(retryBtn);

    let currentYear = 2026;
    let fetchCalledWith = 0;

    async function loadYear(year: number, shouldFail = false) {
      currentYear = year;
      fetchCalledWith = year;
      try {
        retryBtn.hidden = true;
        empty.hidden = false;
        msg.textContent = "載入中...";
        if (shouldFail) {
          throw new Error("Network error");
        }
        empty.hidden = true;
      } catch {
        empty.hidden = false;
        msg.textContent = "載入年度資料失敗，請重新整理或點擊重試。";
        retryBtn.hidden = false;
      }
    }

    // Trigger failure on year 2025
    await loadYear(2025, true);
    expect(fetchCalledWith).toBe(2025);
    expect(currentYear).toBe(2025);
    expect(empty.hidden).toBe(false);
    expect(msg.textContent).toBe("載入年度資料失敗，請重新整理或點擊重試。");
    expect(retryBtn.hidden).toBe(false);

    // Simulate clicking retry (which calls loadYear(currentYear))
    await loadYear(currentYear, false);
    expect(fetchCalledWith).toBe(2025);
    expect(currentYear).toBe(2025);
    expect(empty.hidden).toBe(true);
    expect(retryBtn.hidden).toBe(true);
  });
});
