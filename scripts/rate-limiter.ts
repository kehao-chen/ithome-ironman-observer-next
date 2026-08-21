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
