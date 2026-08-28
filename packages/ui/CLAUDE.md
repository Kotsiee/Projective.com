# CLAUDE.md — `@projective/ui` Guardrails

Local contract for the umbrella UI package. The **authoritative spec** is
[`documentation/design-system/DESIGN_SYSTEM.md`](../../documentation/design-system/DESIGN_SYSTEM.md);
this file is the short, enforceable summary. It sits under the root [`CLAUDE.md`](../../CLAUDE.md).

## What this package is

A single, decoupled, **copy-paste-portable** component library with multi-export sub-paths
(`deno.json` → `exports`). Consumers import a taxonomy: `@projective/ui/layout` · `/navigation` ·
`/fields` · `/display` · `/feedback` · `/overlay` · `/utils`. It plugs into external projects
verbatim because it depends only on the token contract — never on app code.

## Hard rules (merge gates)

1. **Pure CSS + strict BEM. Token-only.** No Tailwind, no CSS-in-JS, no UI-library deps. Read
   `var(--*)`; never hardcode a hex/radius/duration/shadow. This portability is the whole point.
2. **Material You is quarantined.** `@material/material-color-utilities` imports live **only** in
   `system/`. A component importing it fails review.
3. **Signal-first**, dumb islands (no DB/Supabase; `fetch` internal routes only).
4. **Separation hierarchy** (DESIGN_SYSTEM.md §B.4): no four-sided borders on non-interactive
   content — spacing, tonal surface tints, type weight, single hairlines. Full borders = interactive
   only.
5. **Anti-card** (DESIGN_SYSTEM.md §B.4.2, §B.9.7–B.9.8): static content is never boxed; cards never
   nest nor sit inside an elevated panel; a list of cards gets no container card; a region background
   is a **solid** ramp tone (`--bg` / `--surface-1` / `--surface-2`), never a translucent wash — an
   alpha fill is unmeasurable, compounds when nested, and ends up needing a border to rescue it.
6. **Anti-tagification** (§B.11): a pill/chip/tag/badge is a promise of interactivity. Metadata that
   cannot be acted on renders as inline `--text-secondary` text with middot separators. Containment
   is reserved for **controls · lifecycle statuses · required disclosures · counts**. If a reviewer
   asks what happens when a pill is clicked, "nothing" is a finding.
7. **Hierarchy over weight** (§A.4): four registers — display (`--text-3xl`/`--fw-medium`), section
   header (`--text-xs` uppercase/`--fw-semibold`), body (`--text-base`/`--leading-relaxed`, capped at
   `--measure`), meta (`--text-sm`/`--text-secondary`). No heading at `--fw-bold`+; no two adjacent
   levels separated by weight alone; `tabular-nums` on any figure that changes.
8. **Functional transparency only** (§B.4.3): `backdrop-filter` is allowed on viewport-pinned top
   bars, floating sheets/scrims, and marks on arbitrary photography — nowhere else — and always on a
   `::before` underlay, never the element itself.
9. **Accessibility**: reduced-motion jump-to-final; open-dyslexic / CVD / high-contrast token
   overlays; comprehensive ARIA + focus management on every interactive element.
10. **Responsive** on Desktop/Tablet/Mobile out of the box (fluid `clamp()`/container queries).
11. **Motion**: over-damped springs (no bounce); simultaneous whole-tree theme crossfade.
12. **Same-change roster update**: adding/altering a component updates DESIGN_SYSTEM.md §C.1.

## Structure

Unified 7-folder convention (`components/ islands/ styles/ hooks/ wrappers/ types/ core/`),
populated as needed. No `src/` wrapper.

```
packages/ui/
├── deno.json           # sub-path exports, scoped npm deps
├── mod.ts              # umbrella barrel (re-exports every taxonomy)
├── core/  types/       # PACKAGE-shared helpers (cx, styleVars, spacing, flex) & primitive types
├── styles/index.css    # framework-level token contract + synchronized theme transition
├── layout/             # sub-package → components/ + styles/ (+ mod.ts)
├── fields/             # PrimeNG-parity controls → islands/ components/ wrappers/ hooks/ styles/ core/ types/
├── system/             # theming sub-package → components/ + core/ + types/ (ONLY Material import site)
└── navigation/ display/ feedback/ overlay/ utils/   # sub-packages (stubs → grow into the 7 folders)
```

Each sub-package mirrors the same folder shape internally and imports package-shared code from
`../core/` and `../types/`. No page routes or business logic in this package — those live in
`apps/web`.
