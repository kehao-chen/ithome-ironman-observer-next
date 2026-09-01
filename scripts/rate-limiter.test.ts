import { describe, expect, test } from "bun:test";
import { createPacedFetcher, pMap } from "./rate-limiter";

describe("pMap concurrency limiter", () => {
  test("processes all items and preserves input order", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = await pMap(items, async (x) => x * 2, { concurrency: 3 });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  test("enforces concurrency limit deterministically", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    const resolvers: Array<() => void> = [];

    const mapPromise = pMap(
      items,
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const { promise, resolve } = Promise.withResolvers<void>();
        resolvers.push(resolve);
        await promise;
        inFlight--;
      },
      { concurrency: 4 },
    );

    // Yield to let the initial batch of 4 workers start
    await Promise.resolve();
    expect(inFlight).toBe(4);
    expect(maxInFlight).toBe(4);

    // Release resolvers in batches
    while (resolvers.length > 0) {
      const fn = resolvers.shift();
      fn?.();
      await Promise.resolve();
    }

    await mapPromise;
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  test("handles empty list", async () => {
    const res = await pMap([], async (x) => x);
    expect(res).toEqual([]);
  });
});

describe("createPacedFetcher", () => {
  test("enforces concurrency limit across concurrent fetch calls", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const activeResolvers: Array<() => void> = [];

    const mockFetch = async (_input: string | URL | Request) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const { promise, resolve } = Promise.withResolvers<void>();
      activeResolvers.push(resolve);
      await promise;
      inFlight--;
      return new Response("ok", { status: 200 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 0,
      fetchFn: mockFetch,
    });

    const tasks = [
      fetcher("https://example.com/1"),
      fetcher("https://example.com/2"),
      fetcher("https://example.com/3"),
      fetcher("https://example.com/4"),
    ];
    // Wait until 2 workers become active
    while (activeResolvers.length < 2) {
      const { promise: waitPromise, resolve: waitResolve } = Promise.withResolvers<void>();
      setTimeout(waitResolve, 2);
      await waitPromise;
    }
    expect(inFlight).toBe(2);
    expect(maxInFlight).toBe(2);
    // Complete active resolvers one by one
    while (activeResolvers.length > 0) {
      const resolve = activeResolvers.shift()!;
      resolve();
      // Yield to let the next queued fetcher enter
      const { promise: delayPromise, resolve: delayResolve } = Promise.withResolvers<void>();
      setTimeout(delayResolve, 10);
      await delayPromise;
    }
    await Promise.all(tasks);
    expect(maxInFlight).toBe(2);
  });

  test("enforces global minimum interval (pacing) between request dispatches", async () => {
    const dispatchTimestamps: number[] = [];
    const minIntervalMs = 40;

    const mockFetch = async () => {
      dispatchTimestamps.push(Date.now());
      return new Response("ok", { status: 200 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 4,
      minIntervalMs,
      fetchFn: mockFetch,
    });

    const startTime = Date.now();
    const tasks = [
      fetcher("https://example.com/1"),
      fetcher("https://example.com/2"),
      fetcher("https://example.com/3"),
      fetcher("https://example.com/4"),
    ];

    await Promise.all(tasks);
    expect(dispatchTimestamps.length).toBe(4);

    // Check intervals between consecutive dispatches (allowing 5ms timer margin)
    for (let i = 1; i < dispatchTimestamps.length; i++) {
      const diff = dispatchTimestamps[i] - dispatchTimestamps[i - 1];
      expect(diff).toBeGreaterThanOrEqual(minIntervalMs - 5);
    }

    const totalElapsed = Date.now() - startTime;
    expect(totalElapsed).toBeGreaterThanOrEqual(minIntervalMs * 3 - 10);
  });

  test("handles HTTP 429 with numeric Retry-After header and pauses queue globally", async () => {
    const dispatchLog: Array<{ url: string; time: number; attempt: number }> = [];
    let req1Attempts = 0;
    const startTime = Date.now();

    const mockFetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const now = Date.now() - startTime;

      if (url.includes("/retry-429")) {
        req1Attempts++;
        dispatchLog.push({ url, time: now, attempt: req1Attempts });
        if (req1Attempts === 1) {
          // Return 429 with 0.1s (100ms) Retry-After
          return new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "0.1" },
          });
        }
        return new Response("ok on retry", { status: 200 });
      }

      dispatchLog.push({ url, time: now, attempt: 1 });
      return new Response("ok other", { status: 200 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 10,
      fetchFn: mockFetch,
    });

    // Fire two requests concurrently
    const [res1, res2] = await Promise.all([
      fetcher("https://example.com/retry-429"),
      fetcher("https://example.com/other"),
    ]);

    expect(await res1.text()).toBe("ok on retry");
    expect(await res2.text()).toBe("ok other");

    // req1 attempt 1 happens around t=0ms
    // 429 triggers pause of ~100ms
    // req1 attempt 2 and req2 must both dispatch after the ~100ms pause (allowing 15ms margin)
    expect(req1Attempts).toBe(2);
    const pausedDispatches = dispatchLog.filter((d) => d.attempt > 1 || d.url.includes("/other"));
    for (const d of pausedDispatches) {
      expect(d.time).toBeGreaterThanOrEqual(80);
    }
  });

  test("handles HTTP 429 with HTTP Date Retry-After header", async () => {
    let attempts = 0;
    const startTime = Date.now();

    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        // Date in the future (HTTP Date header has 1-second resolution)
        const retryDate = new Date(Date.now() + 1500).toUTCString();
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": retryDate },
        });
      }
      return new Response("ok after date", { status: 200 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 5,
      fetchFn: mockFetch,
    });

    const res = await fetcher("https://example.com/date-429");
    const elapsed = Date.now() - startTime;

    expect(await res.text()).toBe("ok after date");
    expect(attempts).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  test("uses exponential backoff when Retry-After header is missing or invalid on 429/5xx", async () => {
    let attempts = 0;
    const dispatchTimes: number[] = [];

    const mockFetch = async () => {
      attempts++;
      dispatchTimes.push(Date.now());
      if (attempts <= 2) {
        return new Response("internal error", { status: 500 });
      }
      return new Response("success on 3rd", { status: 200 });
    };

    const baseRetryDelayMs = 30;
    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 5,
      baseRetryDelayMs,
      fetchFn: mockFetch,
    });

    const res = await fetcher("https://example.com/500-retry");
    expect(await res.text()).toBe("success on 3rd");
    expect(attempts).toBe(3);

    // attempt 0 -> wait 30ms (2^0 * 30) -> attempt 1 -> wait 60ms (2^1 * 30) -> attempt 2
    const delay1 = dispatchTimes[1] - dispatchTimes[0];
    const delay2 = dispatchTimes[2] - dispatchTimes[1];
    expect(delay1).toBeGreaterThanOrEqual(25);
    expect(delay2).toBeGreaterThanOrEqual(50);
  });

  test("throws Error when retries are exhausted on 429/5xx", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return new Response("too many requests", { status: 429 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 5,
      retries: 2,
      baseRetryDelayMs: 10,
      fetchFn: mockFetch,
    });

    await expect(fetcher("https://example.com/exhaust-429")).rejects.toThrow(
      "HTTP 429 for https://example.com/exhaust-429",
    );
    // Initial (attempt 0) + 2 retries = 3 attempts
    expect(attempts).toBe(3);
  });

  test("retries and recovers when network fetch throws", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("Network connection reset");
      }
      return new Response("recovered from net err", { status: 200 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 5,
      retries: 2,
      baseRetryDelayMs: 15,
      fetchFn: mockFetch,
    });

    const res = await fetcher("https://example.com/net-err");
    expect(await res.text()).toBe("recovered from net err");
    expect(attempts).toBe(2);
  });

  test("rethrows original network error when network retries are exhausted", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      throw new Error("Fatal network failure");
    };

    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 5,
      retries: 2,
      baseRetryDelayMs: 10,
      fetchFn: mockFetch,
    });

    await expect(fetcher("https://example.com/fatal-net")).rejects.toThrow("Fatal network failure");
    expect(attempts).toBe(3);
  });

  test("does not retry on normal non-429/non-5xx responses like 404", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 2,
      minIntervalMs: 5,
      fetchFn: mockFetch,
    });

    const res = await fetcher("https://example.com/not-found");
    expect(res.status).toBe(404);
    expect(attempts).toBe(1);
  });
});

describe("createPacedFetcher — per-attempt timeout", () => {
  test("aborts an attempt that outlives timeoutMs and retries it", async () => {
    const seenSignals: (AbortSignal | null | undefined)[] = [];
    let attempts = 0;
    const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      attempts++;
      seenSignals.push(init?.signal);
      if (attempts === 1) {
        // Never settles on its own — only the timeout signal can end it.
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return new Response("ok", { status: 200 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 1,
      minIntervalMs: 0,
      retries: 1,
      baseRetryDelayMs: 0,
      timeoutMs: 20,
      fetchFn: mockFetch,
    });

    const res = await fetcher("https://example.com/hang");
    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
    // Each attempt gets its OWN signal — a shared one would leave the retry with
    // an already-fired deadline and abort it instantly.
    expect(seenSignals[0]).not.toBe(seenSignals[1]);
    expect(seenSignals[1]?.aborted).toBe(false);
  });

  test("preserves a caller-supplied signal alongside the timeout", async () => {
    const controller = new AbortController();
    const mockFetch = async (_input: string | URL | Request, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        // The abort can land before fetchFn is even reached (the limiter awaits a
        // concurrency slot first), so check the flag before attaching a listener.
        if (signal?.aborted) return reject(new Error("aborted by caller"));
        signal?.addEventListener("abort", () => reject(new Error("aborted by caller")));
      });

    const fetcher = createPacedFetcher({
      concurrency: 1,
      minIntervalMs: 0,
      retries: 0,
      timeoutMs: 60_000,
      fetchFn: mockFetch,
    });

    const pending = fetcher("https://example.com/slow", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("aborted by caller");
  });

  test("timeoutMs: 0 disables the deadline and leaves init untouched", async () => {
    let seenSignal: AbortSignal | null | undefined = null;
    const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      seenSignal = init?.signal;
      return new Response("ok", { status: 200 });
    };

    const fetcher = createPacedFetcher({ concurrency: 1, minIntervalMs: 0, timeoutMs: 0, fetchFn: mockFetch });
    await fetcher("https://example.com/no-deadline");
    expect(seenSignal).toBeUndefined();
  });
});

describe("createPacedFetcher — per-call retry override", () => {
  test("honours a per-call retries override without a second limiter", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return new Response("boom", { status: 503 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 1,
      minIntervalMs: 0,
      retries: 3,
      baseRetryDelayMs: 0,
      fetchFn: mockFetch,
    });

    await expect(fetcher("https://example.com/flaky", undefined, { retries: 1 })).rejects.toThrow("HTTP 503");
    expect(attempts).toBe(2); // 1 initial + 1 override retry, not the default 3
  });

  test("an undefined override falls back to the configured default", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return new Response("boom", { status: 503 });
    };

    const fetcher = createPacedFetcher({
      concurrency: 1,
      minIntervalMs: 0,
      retries: 2,
      baseRetryDelayMs: 0,
      fetchFn: mockFetch,
    });

    await expect(fetcher("https://example.com/flaky", undefined, { retries: undefined })).rejects.toThrow("HTTP 503");
    expect(attempts).toBe(3);
  });
});
