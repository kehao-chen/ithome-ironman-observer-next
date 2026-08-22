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
  concurrency?: number; // default 2
  minIntervalMs?: number; // default 150
  retries?: number; // default 3
  fetchFn?: typeof fetch; // default globalThis.fetch
  baseRetryDelayMs?: number; // default 2000
}

export type PacedFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
    if (!isNaN(seconds) && isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
  }
  const dateMs = Date.parse(trimmed);
  if (!isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return Math.max(0, diff);
  }
  return baseRetryDelayMs * 2 ** attempt;
}

export function createPacedFetcher(options?: PacedFetchOptions): PacedFetcher {
  const concurrency = Math.max(1, options?.concurrency ?? 2);
  const minIntervalMs = Math.max(0, options?.minIntervalMs ?? 150);
  const retries = Math.max(0, options?.retries ?? 3);
  const baseRetryDelayMs = Math.max(0, options?.baseRetryDelayMs ?? 2000);
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

  return async function pacedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    await acquireConcurrencySlot();
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        await acquireDispatchSlot();

        let res: Response;
        try {
          res = await fetchFn(input, init);
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
