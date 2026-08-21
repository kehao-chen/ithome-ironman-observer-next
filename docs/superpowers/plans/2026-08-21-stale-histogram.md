# 斷更單日落點分佈圖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將「斷更觀察」圖表重構為「單日斷更落點分佈柱狀圖」，直觀展示 Day 1 ~ Day 29 各參賽日的斷更數量與高峰。

**Architecture:** 在 `web/src/lib/insights.ts` 基於 `staleObservation` 新增 `staleDayDistribution` 純函式，輸出單日分桶統計；SSR 與 client 圖表共用此分佈資料繪製 ECharts 垂直柱狀圖。

**Tech Stack:** Astro 5, TypeScript, Bun test, ECharts.

## Global Constraints

- 斷更判定嚴格沿用 `staleObservation`（`stalenessDays >= 2`，排除 `dayCount === 0` 與 `dayCount >= 30`）。
- 圖表為標準垂直柱狀圖，移除動態計算橫條高度的舊邏輯（改用 CSS 預設高度）。
- Tooltip 與標籤須清晰反映單日斷更數與佔比。

---

### Task 1: Implement `staleDayDistribution` pure function and tests

**Files:**
- Modify: `web/src/lib/insights.ts`
- Test: `web/src/lib/insights.test.ts`

**Interfaces:**
- Produces: `export function staleDayDistribution(series: Series[], today: string): { day: number; label: string; count: number }[]`

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/insights.test.ts`:
```ts
describe("staleDayDistribution", () => {
  const today = "2026-08-21";
  test("統計單日斷更分佈，涵蓋從 Day 1 到最大斷更日", () => {
    const series = [
      makeSeries({ id: 1, title: "S1", dayCount: 1, articles: [article({ publishedAt: "2026-08-18T10:00:00+08:00" })] }),
      makeSeries({ id: 2, title: "S2", dayCount: 1, articles: [article({ publishedAt: "2026-08-18T10:00:00+08:00" })] }),
      makeSeries({ id: 3, title: "S3", dayCount: 4, articles: [article({ publishedAt: "2026-08-18T10:00:00+08:00" })] }),
    ];
    const dist = staleDayDistribution(series, today);
    expect(dist).toEqual([
      { day: 1, label: "Day 1", count: 2 },
      { day: 2, label: "Day 2", count: 0 },
      { day: 3, label: "Day 3", count: 0 },
      { day: 4, label: "Day 4", count: 1 },
    ]);
  });
  test("無斷更系列時回傳空陣列", () => {
    expect(staleDayDistribution([], today)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test web/src/lib/insights.test.ts`
Expected: FAIL (`staleDayDistribution` is not exported)

- [ ] **Step 3: Implement minimal code**

In `web/src/lib/insights.ts`:
```ts
export function staleDayDistribution(
  series: Series[],
  today: string,
): { day: number; label: string; count: number }[] {
  const stale = staleObservation(series, today);
  if (stale.length === 0) return [];
  const maxDay = Math.max(...stale.map((s) => s.dayCount));
  const counts = new Map<number, number>();
  for (const s of stale) {
    counts.set(s.dayCount, (counts.get(s.dayCount) ?? 0) + 1);
  }
  const result: { day: number; label: string; count: number }[] = [];
  for (let day = 1; day <= maxDay; day++) {
    result.push({
      day,
      label: `Day ${day}`,
      count: counts.get(day) ?? 0,
    });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test web/src/lib/insights.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/insights.ts web/src/lib/insights.test.ts
git commit -m "feat(insights): add staleDayDistribution pure function"
```

---

### Task 2: Update Insights SSR component and Client chart to vertical histogram

**Files:**
- Modify: `web/src/components/Insights.astro`
- Modify: `web/src/pages/insights.astro`

**Interfaces:**
- Consumes: `staleDayDistribution(series, today)` and `staleObservation`

- [ ] **Step 1: Update SSR Insights.astro**

In `web/src/components/Insights.astro`:
- Import `staleDayDistribution`
- Compute `stale = staleObservation(data.series, taipeiToday(data.updatedAt));`
- Compute `staleDist = staleDayDistribution(data.series, taipeiToday(data.updatedAt));`
- If `stale.length > 0`, find peak `peak = staleDist.reduce((a, b) => (b.count > a.count ? b : a), staleDist[0])`
- Set `riskLine` to `${stale.length} 個系列已斷更 · 斷更高峰在 Day ${peak.day}（${peak.count} 系列）` (or `所有系列目前都有更新` if empty)
- Heading for chart stays `斷更發生日` or `各日斷更系列數`

- [ ] **Step 2: Update client chart in web/src/pages/insights.astro**

In `web/src/pages/insights.astro`:
- Import `staleDayDistribution`
- In `renderCharts`:
  - Compute `stale = staleObservation(d.series, taipeiToday(d.updatedAt));`
  - Compute `staleDist = staleDayDistribution(d.series, taipeiToday(d.updatedAt));`
  - Total stale count: `totalStale = stale.length`
  - Set chart option on `chart-risk`:
    - `xAxis`: `{ type: "category", data: staleDist.map(b => b.label), ...ax, axisLabel: { ...ax.axisLabel, interval: staleDist.length > 15 ? 1 : 0 } }`
    - `yAxis`: `{ type: "value", name: "斷更數", minInterval: 1, ...ax }`
    - `tooltip`: `{ trigger: "axis", ...tip(c), formatter: (p: any) => { const item = staleDist[p[0]?.dataIndex]; if (!item) return ""; const pct = totalStale > 0 ? ((item.count / totalStale) * 100).toFixed(1) : "0"; return `<b>${item.label}</b><br/>斷更系列數：<b>${item.count}</b>（佔斷更系列 ${pct}%）`; } }`
    - `series`: `[{ type: "bar", data: staleDist.map(b => b.count), itemStyle: { color: c.danger, borderRadius: [2, 2, 0, 0] }, label: { show: true, position: "top", color: c.muted, fontSize: 10, fontFamily: "inherit", formatter: (p: any) => (p.value > 0 ? String(p.value) : "") } }]`
  - Remove any inline `riskEl.style.height` override.
- In `renderText`:
  - Sync the peak summary line.

- [ ] **Step 3: Run full tests and build**

Run: `bun test && bun run build`
Expected: 282+ tests pass, build 4 pages without errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Insights.astro web/src/pages/insights.astro
git commit -m "feat(insights): render stale distribution as vertical histogram"
```
