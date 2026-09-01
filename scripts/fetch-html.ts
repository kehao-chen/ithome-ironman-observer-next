// scripts/fetch-html.ts
import { createPacedFetcher, type PacedFetchOptions } from "./rate-limiter";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FetchHtmlOptions {
  retries?: number;
}

export type HtmlFetcher = (url: string, opts?: FetchHtmlOptions) => Promise<string>;

export function createPacedHtmlFetcher(opts?: PacedFetchOptions): HtmlFetcher {
  // Exactly one paced fetcher per HTML fetcher. A per-call `retries` override is
  // passed through to this shared instance instead of spawning a second one —
  // a second fetcher would carry its own concurrency/interval/back-off state and
  // silently double the request rate against ithelp.
  const pacedFetch = createPacedFetcher(opts);

  return async function pacedHtmlFetch(url: string, callOpts?: FetchHtmlOptions): Promise<string> {
    const res = await pacedFetch(
      url,
      {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      { retries: callOpts?.retries },
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return await res.text();
  };
}

export const fetchHtml: HtmlFetcher = createPacedHtmlFetcher();
