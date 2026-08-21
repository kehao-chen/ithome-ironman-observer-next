import { describe, expect, test } from "bun:test";
import { pMap } from "./rate-limiter";

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
