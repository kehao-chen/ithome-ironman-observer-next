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
});
