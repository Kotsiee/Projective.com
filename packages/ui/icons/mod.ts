/**
 * @projective/ui/icons — the icon contract (DESIGN_SYSTEM.md §B.7).
 *
 * ONE primitive, ONE registry, ONE weight, ONE grid. Import {@link Icon} and a canonical name;
 * never hand-author an `<svg>` in a feature, and never reach for a Unicode character or an emoji as
 * a stand-in — those render in the user's system font at the wrong weight and metrics, and become
 * full-colour glyphs on some platforms.
 *
 * A feature that genuinely owns domain vocabulary (file kinds, fund states, session archetypes)
 * keeps its own glyph module, but renders it through {@link IconShell} so it still inherits the one
 * contract: same grid handling, same rendered stroke, same sizing model, same `aria-hidden` default.
 *
 * Styling contract: Pure CSS + strict BEM, token-only (`--icon-*` in `@projective/ui/styles`).
 */

export { Icon, ICON_PATHS } from "./components/Icon.tsx";
export type { IconName, IconProps, IconSize } from "./components/Icon.tsx";
export { IconShell } from "./components/IconShell.tsx";
export type { IconShellProps } from "./components/IconShell.tsx";
