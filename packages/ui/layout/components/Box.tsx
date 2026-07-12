import type { ComponentChildren, CSSProperties, HTMLAttributes, JSX } from "preact";
import "../styles/box.css";
import { cx } from "../../core/cx.ts";
import { spacingVars } from "../../core/spacing.ts";
import { styleVars } from "../../core/style.ts";
import type { MarginProps, PaddingProps } from "../../types/mod.ts";

export type SurfaceLevel = 0 | 1 | 2 | 3;
export type RadiusToken = "none" | "xs" | "sm" | "base" | "lg" | "xl";

export interface BoxProps
	extends PaddingProps, MarginProps, Omit<HTMLAttributes<HTMLElement>, "style" | "ref"> {
	/** Element tag to render (default `div`). */
	as?: keyof JSX.IntrinsicElements;
	/** Background surface tone: 0 = `--surface`, 1–3 = `--surface-1..3` (§B.4 tonal layering). */
	surface?: SurfaceLevel;
	/** Corner radius token. Full borders are for interactive elements — radius alone is fine here. */
	radius?: RadiusToken;
	/** Grow to fill the available main-axis space when inside a flex container. */
	grow?: boolean;
	style?: CSSProperties;
	children?: ComponentChildren;
}

/**
 * Box — the foundational layout primitive. A polymorphic element with token-driven spacing, surface
 * tint, and radius. Zero client JS.
 */
export function Box(props: BoxProps): JSX.Element {
	const {
		as = "div",
		surface,
		radius,
		grow,
		class: className,
		style,
		children,
		p,
		px,
		py,
		pt,
		pr,
		pb,
		pl,
		m,
		mx,
		my,
		mt,
		mr,
		mb,
		ml,
		...rest
	} = props;

	const vars: Record<string, string | undefined> = spacingVars({
		p,
		px,
		py,
		pt,
		pr,
		pb,
		pl,
		m,
		mx,
		my,
		mt,
		mr,
		mb,
		ml,
	});
	if (surface !== undefined) {
		vars["--box-bg"] = surface === 0 ? "var(--surface)" : `var(--surface-${surface})`;
	}
	if (radius) vars["--box-radius"] = radius === "none" ? "0" : `var(--radius-${radius})`;

	const Tag = as as "div";
	return (
		<Tag
			class={cx("ui-box", grow && "ui-box--grow", className as string)}
			style={styleVars(vars, style)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
