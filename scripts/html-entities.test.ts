// scripts/html-entities.test.ts
import { describe, expect, test } from "bun:test";
import { decodeHtmlEntities } from "./html-entities";

describe("decodeHtmlEntities", () => {
  test("decodes common entities", () => {
    expect(decodeHtmlEntities("ChatGPT &amp; Codex")).toBe("ChatGPT & Codex");
    expect(decodeHtmlEntities("&lt;div&gt; &quot;q&quot; &#39;x&#39; &nbsp;")).toBe('<div> "q" \'x\' \u00a0');
  });

  test("leaves plain text and unknown sequences intact", () => {
    expect(decodeHtmlEntities("Hello 世界 2026")).toBe("Hello 世界 2026");
    expect(decodeHtmlEntities("a &b c")).toBe("a &b c"); // bare & is not an entity
  });

  test("does not double-decode", () => {
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
  });
});
