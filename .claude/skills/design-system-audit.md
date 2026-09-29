---
name: ui-audit
description: Audits CSS and TSX against Projective's DESIGN_SYSTEM.md merge gates
---
Inspect the git diff of apps/web/routes/(dashboard)/wallet/ and features/finance/:
1. Check for anti-patterns:
   - Any Tailwind classes, CSS-in-JS, or inline styles.
   - Any four-sided border around non-interactive regions (violates §B.4).
   - Any card nesting (violates §B.9.2).
   - Hardcoded hex colors, pixel paddings, or ad-hoc border radii.
2. Verify token usage:
   - Are radii using `--radius-*` or `--radius-container-*`?
   - Are colors reading `var(--primary)`, `var(--surface-*)`, or `--hairline`?
   - Are amounts using `<MoneyView />` from `@projective/ui/display`?
3. Report violations by file and line number.