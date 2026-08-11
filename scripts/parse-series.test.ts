// scripts/parse-series.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseSeriesPage, seriesUrl } from "./parse-series";

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
    expect(s.articles[0].title).toBe("Day10：SGLang RVV Attention 後端怎麼接進來");
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
        <h3 class="qa-list__title"><a href="https://ithelp.ithome.com.tw/articles/10402381" class="qa-list__title-link">Day10：SGLang RVV Attention 後端怎麼接進來</a></h3>
        <div class="qa-list__info"><a title="2026-08-11 07:41:43" class="qa-list__info-time">2026-08-11</a></div>
      </div>
    </div>
  </div>
  <div class="profile-pagination"><ul class="pager"><li class="disabled"><span>下一頁</span></li></ul></div>
</div>
<div class="rightside profile-side"></div>`;
}
