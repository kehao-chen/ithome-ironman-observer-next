// scripts/fetch-html.test.ts
import { describe, expect, test } from "bun:test";
import { fetchHtml, BROWSER_UA } from "./fetch-html";

describe("fetchHtml", () => {
  test("sends browser UA and returns body", async () => {
    const html = await fetchHtml("https://ithelp.ithome.com.tw/2026ironman/signup/list");
    expect(html).toContain("報名數");
    expect(html.length).toBeGreaterThan(1000);
  });

  test("retries then throws on persistent 404", async () => {
    await expect(fetchHtml("https://ithelp.ithome.com.tw/definitely-not-a-page-404", { retries: 1 }))
      .rejects.toThrow(/404/);
  });
});
