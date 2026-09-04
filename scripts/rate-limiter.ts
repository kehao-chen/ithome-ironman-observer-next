// scripts/rate-limiter.ts

export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: { concurrency?: number; delayMs?: number } = {},
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const delayMs = opts.delayMs ?? 0;
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
      if (delayMs > 0 && nextIndex < items.length) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, delayMs);
        await promise;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export interface PacedFetchOptions {
  concurrency?: number; // default 1
  minIntervalMs?: number; // default 1000
  retries?: number; // default 3
  // Per-attempt hard ceiling; 0 disables. Without it a single hung socket stalls
  // the whole scrape — the GitHub Actions job would sit there and the
  // `data-update-main` concurrency group blocks every later run behind it.
  timeoutMs?: number; // default 15000
  // Structural signature, not `typeof fetch`: the implementation only ever calls
  // (input, init) => Promise<Response>, and pinning it to the platform `fetch`
  // type forces every test double to carry runtime-specific extras (Bun's
  // `fetch.preconnect`) that this module never touches.
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  // default globalThis.fetch
  baseRetryDelayMs?: number; // default 5000
}

/**
 * Per-call overrides. `retries` is deliberately a call-time argument rather than
 * something you get by building a second fetcher: concurrency slots, the minimum
 * dispatch interval and the 429 back-off window all live in one closure, so a
 * second fetcher would pace itself independently and double the real request
 * rate against ithelp.
 */
export type PacedFetchOverrides = { retries?: number };

export type PacedFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
  overrides?: PacedFetchOverrides,
) => Promise<Response>;

function getUrlString(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  if (input && typeof input === "object" && "url" in input && typeof input.url === "string") {
    return input.url;
  }
  return String(input);
}

function parseRetryAfter(
  headerValue: string | null | undefined,
  attempt: number,
  baseRetryDelayMs: number,
): number {
  if (!headerValue) {
    return baseRetryDelayMs * 2 ** attempt;
  }
  const trimmed = headerValue.trim();
  if (!trimmed) {
    return baseRetryDelayMs * 2 ** attempt;
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = parseFloat(trimmed);
    if (!Number.isNaN(seconds) && Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return Math.max(0, diff);
  }
  return baseRetryDelayMs * 2 ** attempt;
}

/**
 * Attach a per-attempt timeout signal to `init`, preserving a caller-supplied
 * `signal` by combining the two (either one aborting aborts the request).
 */
function withTimeout(init: RequestInit | undefined, timeoutMs: number): RequestInit | undefined {
  if (timeoutMs <= 0) return init;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callerSignal = init?.signal;
  return {
    ...init,
    signal: callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal,
  };
}

export function createPacedFetcher(options?: PacedFetchOptions): PacedFetcher {
  const envConcurrency = process.env.CRAWLER_CONCURRENCY ? Number(process.env.CRAWLER_CONCURRENCY) : undefined;
  const envMinInterval = process.env.CRAWLER_MIN_INTERVAL_MS ? Number(process.env.CRAWLER_MIN_INTERVAL_MS) : undefined;
  const concurrency = Math.max(1, options?.concurrency ?? envConcurrency ?? 1);
  const minIntervalMs = Math.max(0, options?.minIntervalMs ?? envMinInterval ?? 1000);
  const defaultRetries = Math.max(0, options?.retries ?? 3);
  const baseRetryDelayMs = Math.max(0, options?.baseRetryDelayMs ?? 5000);
  const timeoutMs = Math.max(0, options?.timeoutMs ?? 15_000);
  const fetchFn = options?.fetchFn ?? globalThis.fetch;

  let activeCount = 0;
  const waitQueue: Array<() => void> = [];

  let pauseUntil = 0;
  let lastScheduledTime = 0;
  let scheduleChain = Promise.resolve();

  async function acquireConcurrencySlot(): Promise<void> {
    if (activeCount < concurrency) {
      activeCount++;
      return;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    waitQueue.push(resolve);
    await promise;
  }

  function releaseConcurrencySlot(): void {
    if (waitQueue.length > 0) {
      const next = waitQueue.shift();
      next?.();
    } else {
      activeCount--;
    }
  }

  async function acquireDispatchSlot(): Promise<void> {
    const prevChain = scheduleChain;
    const { promise: currentPromise, resolve: releaseCurrent } = Promise.withResolvers<void>();
    scheduleChain = currentPromise;

    await prevChain;

    try {
      while (true) {
        const now = Date.now();
        const targetTime = Math.max(now, lastScheduledTime + minIntervalMs, pauseUntil);
        const delayMs = targetTime - now;
        if (delayMs <= 0) {
          lastScheduledTime = Date.now();
          break;
        }
        const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
        setTimeout(delayResolve, delayMs);
        await delayPromise;
      }
    } finally {
      releaseCurrent();
    }
  }

  return async function pacedFetch(
    input: string | URL | Request,
    init?: RequestInit,
    overrides?: PacedFetchOverrides,
  ): Promise<Response> {
    const retries = overrides?.retries === undefined ? defaultRetries : Math.max(0, overrides.retries);
    await acquireConcurrencySlot();
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        await acquireDispatchSlot();

        let res: Response;
        try {
          // Fresh deadline per attempt: one signal hoisted out of the loop would
          // leave later retries with whatever is left of the first attempt's
          // budget, and abort them instantly once it had fired.
          res = await fetchFn(input, withTimeout(init, timeoutMs));
        } catch (err) {
          if (attempt < retries) {
            const waitMs = baseRetryDelayMs * 2 ** attempt;
            pauseUntil = Math.max(pauseUntil, Date.now() + waitMs);
            continue;
          }
          throw err;
        }

        if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
          if (attempt < retries) {
            const retryAfterHeader = res.headers?.get("retry-after") ?? null;
            const waitMs = parseRetryAfter(retryAfterHeader, attempt, baseRetryDelayMs);
            pauseUntil = Math.max(pauseUntil, Date.now() + waitMs);
            continue;
          }
          throw new Error(`HTTP ${res.status} for ${getUrlString(input)}`);
        }

        return res;
      }

      throw new Error(`HTTP fetch retries exhausted for ${getUrlString(input)}`);
    } finally {
      releaseConcurrencySlot();
    }
  };
}
