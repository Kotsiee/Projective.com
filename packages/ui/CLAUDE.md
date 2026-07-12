# CLAUDE.md — `@projective/ui` Guardrails

Local contract for the umbrella UI package. The **authoritative spec** is
[`documentation/design-system/DESIGN_SYSTEM.md`](../../documentation/design-system/DESIGN_SYSTEM.md);
this file is the short, enforceable summary. It sits under the root
[`CLAUDE.md`](../../CLAUDE.md).

## What this package is

A single, decoupled, **copy-paste-portable** component library with multi-export sub-paths
(`deno.json` → `exports`). Consumers import a taxonomy: `@projective/ui/layout` · `/navigation` ·
`/fields` · `/display` · `/feedback` · `/overlay` · `/utils`. It plugs into external projects verbatim
because it depends only on the token contract — never on app code.

## Hard rules (merge gates)

1. **Pure CSS + strict BEM. Token-only.** No Tailwind, no CSS-in-JS, no UI-library deps. Read
   `var(--*)`; never hardcode a hex/radius/duration/shadow. This portability is the whole point.
2. **Material You is quarantined.** `@material/material-color-utilities` imports live **only** in
   `system/`. A component importing it fails review.
3. **Signal-first**, dumb islands (no DB/Supabase; `fetch` internal routes only).
4. **Separation hierarchy** (DESIGN_SYSTEM.md §B.4): no four-sided borders on non-interactive
   content — spacing, tonal surface tints, type weight, single hairlines. Full borders =
   interactive only.
5. **Accessibility**: reduced-motion jump-to-final; open-dyslexic / CVD / high-contrast token
   overlays; comprehensive ARIA + focus management on every interactive element.
6. **Responsive** on Desktop/Tablet/Mobile out of the box (fluid `clamp()`/container queries).
7. **Motion**: over-damped springs (no bounce); simultaneous whole-tree theme crossfade.
8. **Same-change roster update**: adding/altering a component updates DESIGN_SYSTEM.md §C.1.

## Structure

```
packages/ui/
├── deno.json          # name, version, sub-path exports, scoped npm deps
├── mod.ts             # umbrella barrel (re-exports every taxonomy)
├── src/<taxonomy>/    # layout · navigation · fields · display · feedback · overlay · utils
├── system/            # theming engine + DesignSystemProvider + asset-registry (ONLY Material import site)
└── styles/index.css   # framework-level token contract + synchronized theme transition
```

No page routes or business logic in this package — those live in `apps/web`.
