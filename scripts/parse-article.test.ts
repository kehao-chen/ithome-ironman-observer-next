// scripts/parse-article.test.ts
import { describe, expect, test } from "bun:test";
import { parseArticleDay } from "./parse-article";
import { readFixture } from "./test-utils";

describe("parseArticleDay", () => {
  test("真實文章頁（帶刺哥第 30 篇）→ 官方參賽天數 12（大量補發不增加 streak）", () => {
    expect(parseArticleDay(readFixture("article-page.html"))).toBe(12);
  });

  test("無徽章（一般文章頁/錯誤頁）→ null", () => {
    expect(parseArticleDay("<html><body><h1>普通文章</h1></body></html>")).toBeNull();
  });

  test("徽章 0 → null（視為無資料）", () => {
    expect(parseArticleDay('<span class="ir-article__days-num">0</span>')).toBeNull();
  });
});
