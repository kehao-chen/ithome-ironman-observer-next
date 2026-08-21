// scripts/parse-series.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseSeriesPage, seriesUrl, isSeriesPage, isArticlePage } from "./parse-series";

describe("parseSeriesPage", () => {
  test("parses stats and articles", () => {
    const html = readFixture("series-page.html");
    const s = parseSeriesPage(html);
    expect(s.dayCount).toBeGreaterThanOrEqual(1);
    expect(s.articleCount).toBeGreaterThanOrEqual(1);
    expect(s.subscriptions).toBeGreaterThanOrEqual(0);
    expect(s.articles.length).toBe(s.articleCount);
    const a = s.articles[0];
    expect(a.id).toBeGreaterThan(10000000);
    expect(a.title).toContain("Day 1");
    expect(a.url).toMatch(/articles\/\d+/);
    expect(a.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof a.views).toBe("number");
    expect(typeof a.likes).toBe("number");
    expect(typeof a.comments).toBe("number");
  });

  test("articles have all three stats", () => {
    const html = readFixture("series-page.html");
    const s = parseSeriesPage(html);
    for (const a of s.articles) {
      expect(a.views).toBeGreaterThanOrEqual(0);
      expect(a.likes).toBeGreaterThanOrEqual(0);
      expect(a.comments).toBeGreaterThanOrEqual(0);
    }
  });

  test("無分頁（fixture）→ nextPage null", () => {
    const s = parseSeriesPage(readFixture("series-page.html"));
    expect(s.nextPage).toBeNull();
  });

  test("分頁第 1 頁：有下一頁、DAY 徽章取官方數字", () => {
    const s = parseSeriesPage(page1Html());
    expect(s.dayCount).toBe(11);
    expect(s.articleCount).toBe(11);
    expect(s.nextPage).toBe("?page=2");
    expect(s.articles.map((a) => a.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // 官方 DAY 徽章（ir-qa-list__days）優先於標題 fallback
    expect(s.articles[9].day).toBe(10);
    expect(s.articles[9].title).toBe("Day10：標題 10");
    expect(s.articles[9].url).toBe("https://ithelp.ithome.com.tw/articles/10402230");
  });

  test("分頁第 2 頁：無下一頁、DAY 徽章續接", () => {
    const s = parseSeriesPage(page2Html());
    expect(s.dayCount).toBe(11);
    expect(s.articleCount).toBe(11);
    expect(s.nextPage).toBeNull();
    expect(s.articles.map((a) => a.day)).toEqual([11]);
    expect(s.articles[0].title).toBe("Day11：SGLang RVV Attention 後端怎麼接進來");
  });

  test("徽章凍結：標題 Day N 優先於凍結的徽章（帶刺哥 p2 實測）", () => {
    // iThome 把 p2 整頁徽章塞成「當下參賽天數 12」：DAY 11 + DAY 12×9，
    // 但標題是 Day 11..Day 20。2026-08-18 帶刺哥 series 9128 實測。
    const html = `
<div class="board leftside profile-main">
  ${Array.from({ length: 10 }, (_, i) => {
    const day = 11 + i;
    const badge = i === 0 ? 11 : 12;
    return `<div class="qa-list profile-list ir-profile-list"><div class="profile-list__condition">
      <div class="ir-qa-list__status"><span class="ir-qa-list__days ir-qa-list__days--profile ir-qa-list__days--fail">DAY ${badge}</span></div>
      <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/${10403000 + day}" class="qa-list__title-link">Day ${day}｜標題 ${day}</a></h3>
      <div class="qa-list__info"><a title="2026-08-${String(day).padStart(2, "0")} 12:00:00" class="qa-list__info-time"></a></div>
    </div></div>`;
  }).join("\n")}
  <div class="profile-pagination"><ul class="pager"><li class="disabled"><span>下一頁</span></li></ul></div>
</div>`;
    const s = parseSeriesPage(html);
    expect(s.articles.map((a) => a.day)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  test("徽章凍結：無標題 Day 前綴時頁內連續性修正（fishbob 實測）", () => {
    // 徽章 1,1,2,3,4,5,6 對應標題 D01..D07（無「Day N」前綴）：
    // 第一筆用徽章 1，後續徽章 <= 上一篇 → 續接。2026-08-18 fishbob series 9176 實測。
    const titles = ["D01 一個沒有維運團隊的我", "D02 AI 的記憶會過期", "D03 網域 DNS", "Day 04 裝完系統", "D05 我的機台", "D06 把路由器做成一台VM", "D07 建立範本"];
    const badges = [1, 1, 2, 3, 4, 5, 6];
    const html = `
<div class="board leftside profile-main">
  ${titles.map((t, i) => `<div class="qa-list profile-list ir-profile-list"><div class="profile-list__condition">
      <div class="ir-qa-list__status"><span class="ir-qa-list__days ir-qa-list__days--profile">DAY ${badges[i]} </span></div>
      <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/${10401879 + i}" class="qa-list__title-link">${t}</a></h3>
      <div class="qa-list__info"><a title="2026-08-0${i + 1} 12:00:00" class="qa-list__info-time"></a></div>
    </div></div>`).join("\n")}
  <div class="profile-pagination"><ul class="pager"><li class="disabled"><span>下一頁</span></li></ul></div>
</div>`;
    const s = parseSeriesPage(html);
    expect(s.articles.map((a) => a.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("徽章無數字（只有 DAY 文字）不產生 NaN", () => {
    // fishbob 某些頁面徽章 span 內只有「DAY」沒有數字 → 回退標題 Day 前綴。
    const html = `
<div class="board leftside profile-main">
  <div class="qa-list profile-list ir-profile-list"><div class="profile-list__condition">
    <div class="ir-qa-list__status"><span class="ir-qa-list__days ir-qa-list__days--profile">DAY</span></div>
    <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/10404001" class="qa-list__title-link">Day 7｜無數徽章測試</a></h3>
    <div class="qa-list__info"><a title="2026-08-07 12:00:00" class="qa-list__info-time"></a></div>
  </div></div>
  <div class="profile-pagination"><ul class="pager"><li class="disabled"><span>下一頁</span></li></ul></div>
</div>`;
    const s = parseSeriesPage(html);
    expect(s.articles[0].day).toBe(7);
  });
});

// 模擬真實頁面的分頁結構：每頁 10 篇、每個 block 都包一層 qa-list wrapper、
// 巢狀 DAY 徽章、第 1 頁帶 profile-pagination rel="next"（相對網址）。
function page1Html(): string {
  return `
<div class="board leftside profile-main">
  <div class="qa-list__info qa-list__info--ironman subscription-group">
    <span>參賽天數 11 天 ｜</span>
    <span>共 11 篇文章 ｜</span>
    <span class="subscription-amount">6</span> 人訂閱
  </div>
  <!-- articles -->
  ${Array.from({ length: 10 }, (_, i) => {
    const day = i + 1;
    return `<div class="qa-list profile-list ir-profile-list">
      <div class="profile-list__condition">
        <a class="qa-condition"><span class="qa-condition__count">0</span><span class="qa-condition__text">Like</span></a>
        <a class="qa-condition"><span class="qa-condition__count">0</span><span class="qa-condition__text">留言</span></a>
        <a class="qa-condition"><span class="qa-condition__count">0</span><span class="qa-condition__text">瀏覽</span></a>
        <div class="profile-list__content">
          <div class="ir-qa-list__status"><span class="ir-qa-list__days ir-qa-list__days--profile">DAY ${day} </span></div>
          <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/${10402220 + day}" class="qa-list__title-link">Day${String(day).padStart(2, "0")}：標題 ${day}</a></h3>
          <div class="qa-list__info"><a title="2026-08-${String(day).padStart(2, "0")} 07:41:43" class="qa-list__info-time">2026-08-${String(day).padStart(2, "0")}</a></div>
        </div>
      </div>
    </div>`;
  }).join("\n")}
  <div class="profile-pagination"><ul class="pager"><li><a href="https://ithelp.ithome.com.tw/users/20183319/ironman/9029?page=2" rel="next">下一頁</a></li></ul></div>
</div>
<div class="rightside profile-side"></div>`;
}

function page2Html(): string {
  return `
<div class="board leftside profile-main">
  <div class="qa-list__info qa-list__info--ironman subscription-group">
    <span>參賽天數 11 天 ｜</span>
    <span>共 11 篇文章 ｜</span>
    <span class="subscription-amount">6</span> 人訂閱
  </div>
  <!-- articles -->
  <div class="qa-list profile-list ir-profile-list">
    <div class="profile-list__condition">
      <a class="qa-condition"><span class="qa-condition__count">0</span><span class="qa-condition__text">Like</span></a>
      <a class="qa-condition"><span class="qa-condition__count">0</span><span class="qa-condition__text">留言</span></a>
      <a class="qa-condition"><span class="qa-condition__count">0</span><span class="qa-condition__text">瀏覽</span></a>
      <div class="profile-list__content">
        <div class="ir-qa-list__status"><span class="ir-qa-list__days ir-qa-list__days--profile">DAY 11 </span></div>
        <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/10402381" class="qa-list__title-link">Day11：SGLang RVV Attention 後端怎麼接進來</a></h3>
        <div class="qa-list__info"><a title="2026-08-11 07:41:43" class="qa-list__info-time">2026-08-11</a></div>
      </div>
    </div>
  </div>
  <div class="profile-pagination"><ul class="pager"><li class="disabled"><span>下一頁</span></li></ul></div>
</div>
<div class="rightside profile-side"></div>`;

describe("Page validity validators", () => {
  test("isSeriesPage: valid normal series fixture returns true", () => {
    const html = readFixture("series-page.html");
    expect(isSeriesPage(html)).toBe(true);
  });

  test("isSeriesPage: valid 0-article series page returns true", () => {
    const html = `
      <div class="board leftside profile-main">
        <div class="qa-list__info qa-list__info--ironman subscription-group">
          <span>參賽天數 0 天 ｜</span><span>共 0 篇文章 ｜</span>
        </div>
      </div>`;
    expect(isSeriesPage(html)).toBe(true);
  });

  test("isSeriesPage: challenge / error / empty HTML returns false", () => {
    expect(isSeriesPage("<html><body>Just a moment...</body></html>")).toBe(false);
    expect(isSeriesPage("<div>500 Internal Server Error</div>")).toBe(false);
    expect(isSeriesPage("")).toBe(false);
  });

  test("isArticlePage: valid article fixture returns true", () => {
    const html = readFixture("article-page.html");
    expect(isArticlePage(html)).toBe(true);
  });

  test("isArticlePage: challenge / error returns false", () => {
    expect(isArticlePage("<html><body>Challenge</body></html>")).toBe(false);
    expect(isArticlePage("")).toBe(false);
  });
});
}
