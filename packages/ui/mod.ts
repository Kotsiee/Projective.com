/**
 * @projective/ui — umbrella entry point.
 *
 * Prefer importing from a specific taxonomy sub-path (e.g. `@projective/ui/fields`) so consumers
 * only pull what they use. This barrel re-exports every taxonomy for convenience and portability.
 *
 * Taxonomies (see documentation/design-system/DESIGN_SYSTEM.md §C.1):
 *   layout · navigation · fields · display · feedback · overlay · icons · utils
 *
 * Styling contract: Pure CSS + strict BEM, token-only (`var(--*)`). No framework CSS, no CSS-in-JS.
 * The sole permitted third-party UI dependency is `@material/material-color-utilities`, used ONLY
 * by `./system` (the theming engine) — never by a component.
 */

export * from "./layout/mod.ts";
export * from "./icons/mod.ts";
export * from "./navigation/mod.ts";
export * from "./fields/mod.ts";
export * from "./display/mod.ts";
export * from "./feedback/mod.ts";
export * from "./overlay/mod.ts";
export * from "./utils/mod.ts";

// `TreeSelectionMode` is defined by both fields' TreeSelect and display's Tree. An explicit
// re-export overrides the star-export ambiguity at the umbrella (display's is canonical here); both
// remain reachable via their own sub-paths (`@projective/ui/fields`, `@projective/ui/display`).
export type { TreeSelectionMode } from "./display/islands/Tree.tsx";
