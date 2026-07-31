import type { JSX, VNode } from "preact";
import "../styles/icon.css";
import { ICON_PATHS, type IconName } from "../core/paths.tsx";

// #region Types
/**
 * A step on the standalone icon ramp (DESIGN_SYSTEM.md §B.7.3). Omit it — the common case — and the
 * icon takes `1em` and inherits the adjacent text's size, which is the correct relationship and the
 * one that stays correct at every type step without being restated.
 */
export type IconSize = "2xs" | "xs" | "sm" | "md" | "lg" | "xl";

/** Props for {@link Icon}. */
export interface IconProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "size" | "name"> {
	/** The canonical registry name. */
	name: IconName;
	/** Ramp step. Omit for a paired icon so it inherits `1em` from its label. */
	size?: IconSize;
	/**
	 * Render the solid counterpart of a glyph that has one (star, pin). A state attribute rather
	 * than a second component, so the outline and fill variants cannot drift geometrically.
	 */
	filled?: boolean;
	/**
	 * Nudge onto the optical centre for a directional glyph whose visual mass sits off the artboard
	 * centre. Corrects the glyph, never the box.
	 */
	optical?: "left" | "right";
	/**
	 * The accessible name, for the rare icon that IS the control's only content and has no labelled
	 * ancestor. Prefer `aria-label` on the button and leave the icon silent — see §B.7.5. Supplying
	 * this promotes the glyph to `role="img"`; omitting it keeps it `aria-hidden`.
	 */
	title?: string;
}
// #endregion

// #region Icon
/**
 * The single icon primitive. Every glyph in the product renders through this component, which is
 * what makes "one icon set" true rather than aspirational.
 *
 * The root carries no `stroke-width`, no `vector-effect` and no size: those live in `icon.css`
 * against `.ui-icon`, so one stylesheet governs the whole set and a call site cannot opt a glyph
 * into a different weight. `fill="none"` and `stroke="currentColor"` stay here because they are the
 * glyph's own geometry contract, and because colour must inherit (§B.7.6).
 *
 * @example A paired icon — inherits its label's size, silent to screen readers.
 * ```tsx
 * <button class="row">
 *   <Icon name="search" /> Search
 * </button>
 * ```
 * @example An icon-only control — the NAME lives on the button, the glyph stays decorative.
 * ```tsx
 * <button aria-label="Archive conversation">
 *   <Icon name="archive-box" size="md" />
 * </button>
 * ```
 */
export function Icon(
	{ name, size, filled, optical, title, class: cls, ...rest }: IconProps,
): VNode {
	const draw = ICON_PATHS[name];
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls ? `ui-icon ${cls}` : "ui-icon"}
			data-icon={name}
			data-size={size}
			data-filled={filled ? "true" : undefined}
			data-optical={optical}
			role={title ? "img" : undefined}
			aria-label={title}
			aria-hidden={title ? undefined : "true"}
			{...rest}
		>
			{draw()}
		</svg>
	);
}
// #endregion

export { ICON_PATHS };
export type { IconName };
