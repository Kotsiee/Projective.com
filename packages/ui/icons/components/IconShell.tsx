import type { JSX, VNode } from "preact";
import "../styles/icon.css";
import type { IconSize } from "./Icon.tsx";

// #region Types
/** Props for {@link IconShell}. */
export interface IconShellProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "size"> {
	/**
	 * Ramp step, or an explicit pixel size.
	 *
	 * A NUMBER is an escape hatch for a legacy call site that already passes exact pixels, and it is
	 * load-bearing rather than lenient: `.ui-icon` sets `inline-size` in CSS, and a CSS declaration
	 * outranks a `width` presentation attribute — so a glyph migrating onto this contract would
	 * silently collapse from its authored 24px to `1em` if the number had nowhere to go. It is
	 * applied as `--ui-icon-size` so the same rule stays in charge. Prefer a ramp step.
	 */
	size?: IconSize | number;
	/** Render the solid counterpart of a glyph that has one. */
	filled?: boolean;
	/** Nudge onto the optical centre for a directional glyph. */
	optical?: "left" | "right";
}
// #endregion

/**
 * Fold a numeric pixel size into the caller's own `style`, as `--ui-icon-size`.
 *
 * The custom property (rather than a `width` attribute) is the only channel that works, because
 * `.ui-icon` sets `inline-size` in CSS and CSS outranks a presentation attribute.
 */
function sizeStyle(
	size: IconSize | number | undefined,
	style: JSX.SVGAttributes<SVGSVGElement>["style"],
): JSX.SVGAttributes<SVGSVGElement>["style"] {
	if (typeof size !== "number") return style;
	const px = `${size}px`;
	if (style == null) return `--ui-icon-size:${px}`;
	if (typeof style === "string") return `--ui-icon-size:${px};${style}`;
	return { ...style, "--ui-icon-size": px } as JSX.SVGAttributes<SVGSVGElement>["style"];
}

// #region IconShell
/**
 * The base wrapper for a feature-owned glyph module.
 *
 * A feature that owns real domain vocabulary — the file-kind marks, the wallet fund states, the
 * session archetypes — should keep those glyphs in the feature; hoisting them into the shared
 * registry would turn it into a dumping ground. What it must NOT keep is its own private rendering
 * contract, and that is what this component replaces.
 *
 * Before this existed, 23 feature modules each declared their own base `<svg>`: ten different
 * `stroke-width` values, seven viewBoxes and three sizing models, producing a 1.93x spread in
 * rendered stroke across the product. Routing a module's base through here collapses all of that to
 * the one contract without touching a single path.
 *
 * `viewBox` is inherited from `SVGAttributes` and defaults to the canonical 24 units. Passing a
 * legacy grid (16, 20, 14…) is supported so an off-grid glyph can join the set TODAY rather than
 * waiting to be redrawn: `vector-effect: non-scaling-stroke` decouples the rendered stroke from the
 * grid, so a 16-unit and a 24-unit glyph render at the same weight. What it does not fix is
 * proportion, which is why 24 remains the target.
 *
 * @example A feature glyph module's base, after adopting the contract.
 * ```tsx
 * const FolderGlyph = (p: IconShellProps) => (
 *   <IconShell {...p}>
 *     <path d="M3.5 7.5a2 2 0 0 1 2-2h3.3l2 2.5h7.7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
 *   </IconShell>
 * );
 * ```
 */
export function IconShell(
	{ size, viewBox = "0 0 24 24", filled, optical, class: cls, style, children, ...rest }:
		IconShellProps,
): VNode {
	return (
		<svg
			viewBox={viewBox}
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={cls ? `ui-icon ${cls}` : "ui-icon"}
			data-size={typeof size === "string" ? size : undefined}
			data-filled={filled ? "true" : undefined}
			data-optical={optical}
			style={sizeStyle(size, style)}
			aria-hidden="true"
			{...rest}
		>
			{children}
		</svg>
	);
}
// #endregion
