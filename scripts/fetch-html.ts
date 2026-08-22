// scripts/fetch-html.ts
import { createPacedFetcher, type PacedFetchOptions } from "./rate-limiter";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FetchHtmlOptions {
  retries?: number;
}

export type HtmlFetcher = (url: string, opts?: FetchHtmlOptions) => Promise<string>;

export function createPacedHtmlFetcher(opts?: PacedFetchOptions): HtmlFetcher {
  const defaultPacedFetch = createPacedFetcher(opts);

  return async function pacedHtmlFetch(url: string, callOpts?: FetchHtmlOptions): Promise<string> {
    const pacedFetch =
      callOpts?.retries !== undefined && callOpts.retries !== opts?.retries
        ? createPacedFetcher({ ...opts, retries: callOpts.retries })
        : defaultPacedFetch;

    const res = await pacedFetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return await res.text();
  };
}

export const fetchHtml: HtmlFetcher = createPacedHtmlFetcher();
