# 斷更觀察 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Insights 的「完賽風險」改為以 `stalenessDays >= 2` 判定並顯示「Day N 後斷更」的斷更觀察圖表。

**Architecture:** 在 `web/src/lib/insights.ts` 以 `daily-status.ts` 的 `stalenessDays` 建立新的純函式資料介面，取代依 expected/deficit 的 `behindSchedule`。SSR 元件與 client 圖表共用同一筆觀察資料語意；client 以斷更日數繪製水平長條圖。

**Tech Stack:** Astro 5、TypeScript、Bun test、ECharts。

## Global Constraints

- 斷更定義固定為最新文章距臺北今日至少 2 天（`stalenessDays >= 2`）。
- 尚未開賽（`dayCount === 0`）與完賽（`dayCount >= 30`）系列不列入。
- 不再呈現或依賴 `expected` / `deficit` /「落後 X 天」。
- 日期判定必須沿用 `daily-status.ts`，不可建立第二套時區邏輯。
- 使用者資料維持 `textContent` / ECharts formatter 現有安全模式；不新增依賴。

---

### Task 1: Replace schedule insight with stale observations

**Files:**
- Modify: `web/src/lib/insights.ts:256-283`
- Test: `web/src/lib/insights.test.ts`（原 `behindSchedule` 測試區塊）

**Interfaces:**
- Produces: `export type StaleObservationRow = { title: string; author: string; group: string; dayCount: number; staleDays: number }` and `export function staleObservation(series: Series[], today: string): StaleObservationRow[]`.

- [ ] **Step 1: Write the failing tests**

Add tests for `staleObservation` using the existing `makeSeries` and `article` helpers:

```ts
describe("staleObservation", () => {
  const today = "2026-08-21";
  test("連續兩天未發文才列入，並顯示最後完成日與停更天數", () => {
    const rows = staleObservation([
      makeSeries({ id: 1, title: "Day 3", dayCount: 3, articles: [article({ publishedAt: "2026-08-19T10:00:00+08:00" })] }),
      makeSeries({ id: 2, title: "昨天", dayCount: 8, articles: [article({ publishedAt: "2026-08-20T10:00:00+08:00" })] }),
    ], today);
    expect(rows).toEqual([{ title: "Day 3", author: "u", group: "Modern Web", dayCount: 3, staleDays: 2 }]);
  });
  test("排除尚未開賽、完賽與無法判定日期的系列", () => {
    expect(staleObservation([
      makeSeries({ dayCount: 0, articles: [] }),
      makeSeries({ dayCount: 30, articles: [article({ publishedAt: "2026-08-10T10:00:00+08:00" })] }),
      makeSeries({ dayCount: 5, articles: [article({ publishedAt: "invalid" })] }),
    ], today)).toEqual([]);
  });
  test("依 dayCount asc、同日數依 staleDays desc", () => {
    const rows = staleObservation([
      makeSeries({ id: 1, title: "後斷", dayCount: 8, articles: [article({ publishedAt: "2026-08-17T10:00:00+08:00" })] }),
      makeSeries({ id: 2, title: "早斷", dayCount: 3, articles: [article({ publishedAt: "2026-08-19T10:00:00+08:00" })] }),
    ], today);
    expect(rows.map((r) => r.title)).toEqual(["早斷", "後斷"]);
  });
});
```

Update the import from `behindSchedule` to `staleObservation`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test web/src/lib/insights.test.ts`
Expected: FAIL because `staleObservation` is not exported.

- [ ] **Step 3: Implement the minimal pure function**

Import `stalenessDays` from `./daily-status`. Replace `ScheduleRow`/`behindSchedule` with the interface above. For each series, reject `dayCount === 0` or `dayCount >= 30`, use its last article’s `publishedAt`, call `stalenessDays(latest?.publishedAt, today)`, retain only `staleDays >= 2`, map fields, then sort by `dayCount -` and `staleDays` descending.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `bun test web/src/lib/insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/insights.ts web/src/lib/insights.test.ts
git commit -m "feat: model stale observation by break day"
```

### Task 2: Update SSR and client Insights copy/chart

**Files:**
- Modify: `web/src/components/Insights.astro:5-73,194-208`
- Modify: `web/src/pages/insights.astro:437-470,511-512`

**Interfaces:**
- Consumes: `staleObservation(data.series, taipeiToday(data.updatedAt))` and `StaleObservationRow` fields from Task 1.
- Produces: Insights panel titled `斷更觀察`, summary with observation count, and chart labeled by `Day N` with tooltip `已停更 N 天`.

- [ ] **Step 1: Update SSR data and summary**

In `Insights.astro`, import `staleObservation` and `taipeiToday`; calculate `const stale = staleObservation(data.series, taipeiToday(data.updatedAt));`. Replace the panel summary with `所有系列目前都有更新` when empty, otherwise `${stale.length} 個系列已斷更`.

- [ ] **Step 2: Update panel labels**

Change heading `完賽風險` to `斷更觀察` and chart heading `進度落後天數` to `斷更發生日`.

- [ ] **Step 3: Update client chart**

In `web/src/pages/insights.astro`, import `staleObservation` and replace the risk block. Use `staleObservation(d.series, taipeiToday(d.updatedAt))`; y-axis labels `Day ${r.dayCount} 後斷更`; x-axis name `最後完成日`; values `r.dayCount`; label formatter `Day ${p.value}`; tooltip includes title and `已停更 ${r.staleDays} 天`. Set chart height from `stale.length`.

- [ ] **Step 4: Update client summary and empty-year IDs**

Replace `insight-risk-line` text updates with the new count/empty copy. Keep the existing DOM id for minimal surface change. Update the comment and ensure `taipeiToday` is already available in the page script; add the import if absent.

- [ ] **Step 5: Run tests and build**

Run: `bun test web/src/lib/insights.test.ts && bun run build`
Expected: focused tests PASS and Astro build completes successfully.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Insights.astro web/src/pages/insights.astro
git commit -m "feat: rename insights panel to stale observation"
```

### Task 3: Verify observable behavior and update product record

**Files:**
- Modify: `PRODUCT.md:41,81` (only if the existing record still names the old feature)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all repository tests PASS.

- [ ] **Step 2: Verify generated UI copy**

Run: `bun run build`
Expected: build succeeds; generated Insights output contains `斷更觀察` and does not contain `完賽風險` or `落後天數`.

- [ ] **Step 3: Update product wording**

Change the roadmap capability wording from `Completion / activity badge enhancements` only if it describes the renamed panel; preserve historical completion notes and add the current `斷更觀察` semantics to the known UI issues/current behavior record without changing unrelated roadmap history.

- [ ] **Step 4: Commit**

```bash
git add PRODUCT.md
git commit -m "docs: record stale observation terminology"
```
