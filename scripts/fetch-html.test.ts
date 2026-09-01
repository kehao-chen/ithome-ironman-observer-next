// scripts/fetch-html.test.ts
import { describe, expect, test } from "bun:test";
import {
  fetchHtml,
  createPacedHtmlFetcher,
  BROWSER_UA,
} from "./fetch-html";

describe("createPacedHtmlFetcher", () => {
  test("sends default User-Agent and Accept headers", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    let capturedUrl: string | undefined;

    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = init?.headers;
      if (headers instanceof Headers) {
        capturedHeaders = Object.fromEntries(headers.entries());
      } else if (Array.isArray(headers)) {
        capturedHeaders = Object.fromEntries(headers);
      } else if (headers && typeof headers === "object") {
        capturedHeaders = headers as Record<string, string>;
      }
      return new Response("<html><body>test page</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    const fetcher = createPacedHtmlFetcher({ fetchFn: mockFetch });
    const html = await fetcher("https://example.com/article/1");

    expect(html).toBe("<html><body>test page</body></html>");
    expect(capturedUrl).toBe("https://example.com/article/1");
    expect(capturedHeaders?.["User-Agent"]).toBe(BROWSER_UA);
    expect(capturedHeaders?.Accept).toBe(
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    );
  });

  test("respects concurrency and pacing with createPacedHtmlFetcher", async () => {
    let active = 0;
    let maxActive = 0;
    const callTimes: number[] = [];

    const mockFetch = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      callTimes.push(Date.now());
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 40);
      await promise;
      active--;
      return new Response("<div>item</div>", { status: 200 });
    };

    const fetcher = createPacedHtmlFetcher({
      concurrency: 2,
      minIntervalMs: 30,
      fetchFn: mockFetch,
    });

    const urls = [
      "https://example.com/1",
      "https://example.com/2",
      "https://example.com/3",
      "https://example.com/4",
    ];

    const results = await Promise.all(urls.map((u) => fetcher(u)));

    expect(results).toHaveLength(4);
    expect(results.every((r) => r === "<div>item</div>")).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(callTimes.length).toBe(4);
  });

  test("retries on 429 and returns text when successful", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "retry-after": "0.05" },
        });
      }
      return new Response("<h1>Recovered</h1>", { status: 200 });
    };

    const fetcher = createPacedHtmlFetcher({
      retries: 2,
      baseRetryDelayMs: 20,
      fetchFn: mockFetch,
    });

    const html = await fetcher("https://example.com/retry");
    expect(attempts).toBe(2);
    expect(html).toBe("<h1>Recovered</h1>");
  });

  test("throws HTTP error immediately on 404 without retrying 404 status", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return new Response("Not Found", { status: 404 });
    };

    const fetcher = createPacedHtmlFetcher({
      retries: 3,
      fetchFn: mockFetch,
    });

    await expect(fetcher("https://example.com/not-found")).rejects.toThrow("HTTP 404 for https://example.com/not-found");
    expect(attempts).toBe(1);
  });

  test("throws HTTP error on retry exhaustion for 500", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return new Response("Server Error", { status: 500 });
    };

    const fetcher = createPacedHtmlFetcher({
      retries: 2,
      baseRetryDelayMs: 10,
      fetchFn: mockFetch,
    });

    await expect(fetcher("https://example.com/server-error")).rejects.toThrow("HTTP 500 for https://example.com/server-error");
    expect(attempts).toBe(3); // initial + 2 retries
  });

  test("supports per-call retries option override", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return new Response("Server Error", { status: 503 });
    };

    const fetcher = createPacedHtmlFetcher({
      retries: 3,
      baseRetryDelayMs: 10,
      fetchFn: mockFetch,
    });

    await expect(fetcher("https://example.com/override", { retries: 1 })).rejects.toThrow("HTTP 503");
    expect(attempts).toBe(2); // initial + 1 retry
  });
});

describe("fetchHtml default singleton", () => {
  test("sends browser UA and returns body for live page", async () => {
    const html = await fetchHtml("https://ithelp.ithome.com.tw/2026ironman/signup/list");
    expect(html).toContain("報名數");
    expect(html.length).toBeGreaterThan(1000);
  });

  test("throws on 404", async () => {
    await expect(fetchHtml("https://ithelp.ithome.com.tw/definitely-not-a-page-404", { retries: 1 }))
      .rejects.toThrow(/404/);
  });
});

