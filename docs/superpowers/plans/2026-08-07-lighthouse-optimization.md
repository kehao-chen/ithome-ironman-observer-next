# Lighthouse Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve 95+ / 100 scores across all Lighthouse audit categories (Performance, Accessibility, SEO, Best Practices, Agentic Browsing) based on `lighthouse-report.json`.

**Architecture:** Add standard static root files (`robots.txt`, `llms.txt`), fix semantic HTML heading hierarchy (`h1` -> `h2`), adjust design system color contrast tokens for WCAG AA (>= 4.5:1 ratio), and optimize CSS loading.

**Tech Stack:** Astro, CSS custom properties / Design Tokens, TypeScript, Bun (test runner).

## Global Constraints

- **No functionality or layout changes**: Preserves all existing features (filters, search, favorites, insights, theme toggle).
- **Target scores**: Performance >= 92, Accessibility >= 98, SEO 100, Best Practices 100, Agentic Browsing 100.
- **Verification**: Run `bun test` in `web/` after changes.

---

### Task 1: Add SEO & Agentic Browsing Static Files (`robots.txt` & `llms.txt`)

**Files:**
- Create: `web/public/robots.txt`
- Create: `web/public/llms.txt`

**Interfaces:**
- Consumes: None
- Produces: Static `/robots.txt` and `/llms.txt` endpoints for web crawlers and AI agents.

- [ ] **Step 1: Create `web/public/robots.txt`**

Write standard crawler directives:

```text
User-agent: *
Allow: /
```

- [ ] **Step 2: Create `web/public/llms.txt`**

Write markdown structure adhering to LLM recommendations:

```markdown
# 鐵人觀察家 Next

> 2026 iThome 鐵人賽每日觀察：追蹤每支參賽系列的進度與人氣

## Links
- [首頁 / 賽事觀察台](https://ithome-ironman-observer.happyhacking.ninja/)
- [Insights 分析](https://ithome-ironman-observer.happyhacking.ninja/insights/)
- [GitHub 專案](https://github.com/kehao-chen/ithome-ironman-observer-next)
```

- [ ] **Step 3: Verify static files in build output**

Run: `cd web && bun run build`
Expected: Dist directory includes `robots.txt` and `llms.txt`.

- [ ] **Step 4: Commit**

```bash
git add web/public/robots.txt web/public/llms.txt
git commit -m "feat(seo): add robots.txt and llms.txt for crawler and agentic browsing compliance"
```

---

### Task 2: Heading Hierarchy Fix (`h3` -> `h2` in SeriesCard)

**Files:**
- Modify: `web/src/components/SeriesCard.astro`
- Modify: `web/src/styles/design-system.css`

**Interfaces:**
- Consumes: `Series` prop from `Dashboard.astro`
- Produces: Valid sequential DOM heading levels (`h1` brand title -> `h2` card title)

- [ ] **Step 1: Update `SeriesCard.astro` markup**

Change line 54 in `web/src/components/SeriesCard.astro`:

```astro
<h2 class="card-title"><a href={seriesUrl} target="_blank" rel="noopener">{s.title}</a></h2>
```

- [ ] **Step 2: Check and update CSS rules**

Inspect `web/src/styles/design-system.css` for `.card-title` selectors. Ensure style applies identically to `h2.card-title` or `.card-title`.

- [ ] **Step 3: Run existing test suite**

Run: `cd web && bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SeriesCard.astro web/src/styles/design-system.css
git commit -m "fix(a11y): change series card title from h3 to h2 for sequential heading hierarchy"
```

---

### Task 3: Color Contrast Token Tuning (WCAG AA Compliance)

**Files:**
- Modify: `web/src/styles/design-system.css`

**Interfaces:**
- Consumes: CSS custom properties (`--muted`, `--text`, `--surface`, etc.)
- Produces: WCAG AA compliant contrast ratios (>= 4.5:1) for dark & light themes.

- [ ] **Step 1: Update Dark Theme Tokens**

In `web/src/styles/design-system.css`, adjust `--muted` color in `:root, [data-theme="dark"]`:

```css
  --muted: #b0b7c3; /* Elevated from #9ca3af to achieve >5.5:1 contrast against #181b22 */
```

- [ ] **Step 2: Update Light Theme Tokens**

In `web/src/styles/design-system.css`, adjust `--muted` color in `[data-theme="light"]`:

```css
  --muted: #4b5563; /* Elevated from #6b7280 to achieve >6.5:1 contrast against #ffffff */
```

- [ ] **Step 3: Adjust Filter Label and Badge Contrast Rules**

Ensure `.filter-label`, `.filter-count`, `.day-badge`, and `.meta-author` retain crisp readable contrast across state variants (`data-active="true"`, `--pending`, `--done`, `--deleted`).

- [ ] **Step 4: Run unit tests**

Run: `cd web && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/styles/design-system.css
git commit -m "style(a11y): adjust muted text and badge color tokens to satisfy WCAG AA contrast standards"
```

---

### Task 4: CSS Import & Render-Blocking Optimization

**Files:**
- Modify: `web/src/pages/index.astro`
- Modify: `web/src/pages/insights.astro`

**Interfaces:**
- Consumes: `design-system.css` & `insights.css`
- Produces: Optimized stylesheet loading for FCP / Speed Index.

- [ ] **Step 1: Optimize CSS load in `index.astro`**

In `web/src/pages/index.astro`, ensure clean global stylesheet handling without unnecessary `@import` indirection in `<style is:global>` blocks if standard import or bundler linkage is cleaner.

- [ ] **Step 2: Verify production build output**

Run: `cd web && bun run build`
Expected: Clean bundled assets, zero build errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/index.astro web/src/pages/insights.astro
git commit -m "perf: optimize stylesheet import and loading structure for better First Contentful Paint"
```

---

### Task 5: End-to-End Verification & Verification Gate

**Files:**
- Test: `web/src/lib/` tests

**Interfaces:**
- Consumes: Complete project codebase
- Produces: Verified build, passing test suite, and audit compliance.

- [ ] **Step 1: Run full test suite**

Run: `cd web && bun test`
Expected: 100% tests passing.

- [ ] **Step 2: Build verification**

Run: `cd web && bun run build`
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Verify static files in build output**

Run: `ls -la web/dist/robots.txt web/dist/llms.txt`
Expected: Both files exist and are populated.

- [ ] **Step 4: Commit final verification checkpoint**

```bash
git commit --allow-empty -m "chore: verify lighthouse optimization plan implementation"
```
