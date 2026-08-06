# Ironman Observer UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Insights chart readability, add consistent home navigation, and strengthen responsive page hierarchy without adding a chart dependency.

**Architecture:** Keep the existing SSG-safe SVG generators as the single chart source. Add explicit chart geometry (baseline/grid/labels), semantic chart headings, and shared navigation affordances while preserving existing data calculations and client year switching.

**Tech Stack:** Astro 5, TypeScript, native CSS, Bun tests, browser smoke check.

## Global Constraints

- Preserve the existing dark/light theme tokens and Traditional Chinese UI.
- Keep SVG generation in `web/src/lib/charts.ts`; do not introduce a runtime chart library.
- Preserve XML escaping and `textContent` safety for external data.
- Preserve existing chart rect/circle semantics and Insights year switching.
- Keep mobile-first responsive layout and accessible labels/focus states.

---

### Task 1: Improve chart geometry and labels

**Files:**
- Modify: `web/src/lib/charts.ts`
- Test: `web/src/lib/charts.test.ts`

- [ ] Add assertions for chart baseline/grid/axis labeling.
- [ ] Run chart tests and observe the new assertions fail.
- [ ] Add lightweight grid, baseline, plot padding, and readable value labels without changing data semantics.
- [ ] Run chart tests and full Bun tests.

### Task 2: Add cross-page home navigation and semantic chart headings

**Files:**
- Modify: `web/src/components/Dashboard.astro`
- Modify: `web/src/components/Insights.astro`
- Modify: `web/src/styles/design-system.css`
- Modify: `web/src/styles/insights.css`

- [ ] Add a shared visible home link to both headers, with current-page navigation remaining clear.
- [ ] Add chart subheadings so each SVG has an explicit reading target.
- [ ] Tune header wrapping, panel spacing, chart surfaces, and narrow viewport behavior.
- [ ] Keep existing controls and links intact.

### Task 3: Verify rendered UI

**Files:**
- Verify: `web/` build output and routes `/` and `/insights/`

- [ ] Run `bun run check` and `bun run build`.
- [ ] Start Astro dev server and inspect desktop/mobile routes in a browser.
- [ ] Run the Impeccable detector against changed UI files.
- [ ] Fix only issues observed in the bounded verification pass and rerun build/browser check.
