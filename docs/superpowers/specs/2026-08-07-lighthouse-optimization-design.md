# 2026-08-07 Lighthouse Optimization Design Spec

## Overview
Based on the Lighthouse audit report (`lighthouse-report.json`), this spec outlines the comprehensive optimizations across Performance, Accessibility, SEO, Best Practices, and Agentic Browsing. The goal is to achieve 95+ / 100 scores across all Lighthouse categories without altering existing feature behavior or UI aesthetics.

---

## 1. SEO & Agentic Browsing Audit Fixes

### 1.1 `public/robots.txt`
- **Issue**: Requests to `/robots.txt` currently fall back to the 404/index HTML document (`<!DOCTYPE html>...`), causing 137 syntax errors in Lighthouse audit.
- **Fix**: Create `web/public/robots.txt` with valid crawler directives:
  ```text
  User-agent: *
  Allow: /
  ```

### 1.2 `public/llms.txt`
- **Issue**: Lighthouse Agentic Browsing score is low (33/100) due to missing `llms.txt` or invalid structure (lacking standard `# Title` header and markdown link structure).
- **Fix**: Create `web/public/llms.txt` following standard recommendations:
  ```markdown
  # 鐵人觀察家 Next

  > 2026 iThome 鐵人賽每日觀察：追蹤每支參賽系列的進度與人氣

  ## Links
  - [首頁 / 賽事觀察台](https://ithome-ironman-observer.happyhacking.ninja/)
  - [Insights 分析](https://ithome-ironman-observer.happyhacking.ninja/insights/)
  - [GitHub 專案](https://github.com/kehao-chen/ithome-ironman-observer-next)
  ```

---

## 2. Accessibility (a11y) Fixes

### 2.1 Heading Hierarchy Adjustment
- **Issue**: In `web/src/components/Dashboard.astro`, the page title is `<h1 class="brand-title">`. Inside `<div class="series-grid">`, `SeriesCard.astro` uses `<h3 class="card-title">`, skipping `<h2` and breaking sequential heading levels.
- **Fix**: Update `web/src/components/SeriesCard.astro` title element from `<h3 class="card-title">` to `<h2 class="card-title">`.
- **CSS Impact**: Update any explicit `h3.card-title` CSS selectors in `design-system.css` to `.card-title` or `h2.card-title`.

### 2.2 WCAG AA Color Contrast Adjustments (273 elements)
- **Issue**: Muted text and badge elements do not achieve the 4.5:1 WCAG AA contrast ratio against their respective background surfaces.
- **Fix**:
  - **Dark Mode (`:root`, `[data-theme="dark"]`)**:
    - Adjust `--muted`: from `#9ca3af` to `#b0b7c3` (Contrast ratio vs `#181b22` increases from ~4.47:1 to >5.8:1).
    - `.filter-label` & `.filter-count`: Ensure foreground color contrast vs button surface is >= 4.5:1.
    - `.day-badge` variants: Increase badge text contrast for `.day-badge--pending`, `.day-badge--done`, `.day-badge--deleted`.
    - Secondary meta text (`.meta-author`, `.updated`, `.latest-views`, `.sort-label`): Verify and elevate contrast.
  - **Light Mode (`[data-theme="light"]`)**:
    - Adjust `--muted`: from `#6b7280` to `#4b5563` (Contrast ratio vs `#ffffff` increases to >6.5:1).
    - Light theme filter & badge contrast verification.

---

## 3. Performance & CSS Loading Optimizations

### 3.1 Render-Blocking CSS Optimization
- **Issue**: `_astro/index.BiVgtagM.css` is flagged as render-blocking.
- **Fix**:
  - In `web/src/pages/index.astro` and `web/src/pages/insights.astro`, ensure global style imports use clean `<style>` bundling or link preloads so Vite and Astro inline critical tokens or eliminate unnecessary render blocks.

---

## 4. Testing & Verification

1. **Automated Unit Tests**: Run `bun test` in `web/` to ensure no client/server TS logic breaks.
2. **HTML Validation**: Inspect rendered HTML to confirm:
   - `/robots.txt` returns plain text headers and directives.
   - `/llms.txt` starts with `# 鐵人觀察家 Next`.
   - Card titles use `h2` tag.
3. **Contrast Audit**: Re-evaluate contrast ratios against WCAG AA 4.5:1 benchmark across all light and dark theme components.
