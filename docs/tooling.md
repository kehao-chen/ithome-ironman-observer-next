# Tooling

## Biome (`biome.json`)

Added after a health check found the repo had no linter at all.

### Linter: on

It earns its keep. On the first run it flagged
`lint/correctness/noUnreachable` in `scripts/parse-series.test.ts`: a missing
closing brace had swallowed the whole `describe("Page validity validators")`
block into `page2Html()`, *after* its `return`. Seven tests had never executed.
Closing the function took the file from 9 to 16 passing tests.

Two rules are off by choice:

- `suspicious/noExplicitAny` — client code reads `window.IRONMAN_DATA`, which
  has no ambient type.
- `style/noNonNullAssertion` — `getElementById(...)!` is used throughout for
  elements the SSG template guarantees exist.

`assist/source/organizeImports` is off: it would reorder imports in 26 files to
enforce an ordering the project never claimed to follow.

### Formatter: off

Deliberate. Running `biome format --write` produced **1407 insertions / 662
deletions across 38 files** and made the code worse in two specific ways:

1. It stripped the aligned trailing comments that document field semantics —
   e.g. in `web/src/lib/card.ts`, `progressPct: number;   // 0–100 (clamped…)`
   collapses to a single space, breaking the visual column.
2. At the `lineWidth` this codebase actually uses, it flattened readable
   multi-line imports into 160-character single lines.

The codebase is internally consistent (2-space indent, double quotes,
semicolons) without a formatter enforcing it. If a formatter is ever adopted,
do it as one isolated commit so the reflow does not bury real changes — not
mixed into a functional change.

## Running the checks

```
bun run check      # typecheck + test + astro check
bunx biome check   # lint
```

CI (`.github/workflows/ci.yml`) runs all of these on push and pull request.
