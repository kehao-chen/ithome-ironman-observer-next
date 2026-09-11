// scripts/parse-signup.test.ts
import { describe, expect, test } from "bun:test";
import { readFixture } from "./test-utils";
import { parseSignupList } from "./parse-signup";

describe("parseSignupList", () => {
  test("parses cards from fixture", () => {
    const html = readFixture("signup-page.html");
    const cards = parseSignupList(html);
    expect(cards.length).toBe(10);
    const first = cards[0];
    expect(first.seriesId).toBeGreaterThan(9000);
    expect(first.userId).toBeGreaterThan(20000000);
    expect(first.name.length).toBeGreaterThan(0);
    expect(first.group.length).toBeGreaterThan(0);
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.signupDate).toMatch(/^\d{4}\/\d{2}\/\d{2}/);
    expect(typeof first.day).toBe("number");
    expect(first.day).toBeGreaterThanOrEqual(0);
  });

  test("day is 0 for 尚未開賽 cards", () => {
    const html = readFixture("signup-page.html");
    const cards = parseSignupList(html);
    const notStarted = cards.find((c) => c.day === 0);
    // page 1 of live list contains at least one not-started card (verified)
    expect(notStarted).toBeDefined();
  });

  test("HTML entities decoded (no &amp; in output)", () => {
    const html = readFixture("signup-page.html");
    const cards = parseSignupList(html);
    for (const c of cards) {
      expect(c.group).not.toContain("&amp;");
      expect(c.title).not.toContain("&amp;");
      expect(c.name).not.toContain("&amp;");
    }
    expect(cards.some((c) => c.group === "ChatGPT & Codex")).toBe(true);
  });

  test("day is extracted from team-dashboard__day, ignoring Day numbers in title/desc", () => {
    const sampleHtml = `
      <div class="list-card">
        <a href="/users/123/ironman/456"></a>
        <div class="contestants-list__name">test</div>
        <div class="tag"><span>AI</span></div>
        <div class="contestants-list__title title">Day6500 組差分</div>
        <div class="contestants-list__desc content">Day 999 description</div>
        <div class="contestants-list__date date">報名日期：2026/08/01 12:00:00</div>
        <div class="team-dashboard__box">
          <label class="note team-dashboard__day">
            DAY 6
          </label>
        </div>
      </div>
    `;
    const cards = parseSignupList(sampleHtml);
    expect(cards).toHaveLength(1);
    expect(cards[0].day).toBe(6);
  });
});
