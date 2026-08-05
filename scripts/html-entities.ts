// scripts/html-entities.ts
// Decode the HTML entities ithelp emits in visible text (e.g. "ChatGPT &amp; Codex").
// Must be applied at parse time so data/*.json stores plain text — Astro/client
// re-escaping would otherwise render "&amp;amp;" to users.
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, "\u00a0");
}
