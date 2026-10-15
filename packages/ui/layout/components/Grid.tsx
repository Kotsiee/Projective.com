import type { ComponentChildren, CSSProperties, HTMLAttributes, JSX } from "preact";
import "../styles/grid.css";
import { cx } from "../../core/cx.ts";
import { space } from "../../core/spacing.ts";
import { styleVars } from "../../core/style.ts";
import type { Space } from "../../types/mod.ts";

export type GridPlacement = "start" | "center" | "end" | "stretch";

export interface GridProps extends Omit<HTMLAttributes<HTMLElement>, "style" | "ref"> {
	as?: keyof JSX.IntrinsicElements;
	/** Fixed column count. Ignored when `minChildWidth` is set (auto-fit takes over). */
	cols?: number;
	/** Responsive auto-fit: minimum track width (e.g. `"16rem"`). Overrides `cols`. */
	minChildWidth?: string;
	/**
	 * Upper bound on the auto-fit column count (only meaningful with `minChildWidth`). Below the cap the
	 * grid stays fully responsive; at wide widths tracks grow rather than multiplying past `maxCols`, so
	 * cards never over-narrow into a cramped many-column row. Pure CSS (RAM formula) — no measurement.
	 */
	maxCols?: number;
	/**
	 * `"stretch"` (default) grows auto-fit tracks to fill the row; `"exact"` keeps every track at
	 * exactly `minChildWidth` (capped at the container, `maxCols` ignored), so a zoom-driven width
	 * scales cards continuously instead of in column-count jumps.
	 */
	fit?: "stretch" | "exact";
	/** Gap between cells. */
	gap?: Space;
	align?: GridPlacement;
	justify?: GridPlacement;
	style?: CSSProperties;
	children?: ComponentChildren;
}

/** Grid — responsive CSS grid. Use `cols` for a fixed count or `minChildWidth` for auto-fit. */
export function Grid(props: GridProps): JSX.Element {
	const {
		as = "div",
		cols,
		minChildWidth,
		maxCols,
		fit = "stretch",
		gap,
		align,
		justify,
		class: className,
		style,
		children,
		...rest
	} = props;
	const auto = minChildWidth !== undefined;
	const exact = auto && fit === "exact";
	const capped = auto && !exact && maxCols !== undefined;
	const vars: Record<string, string | number | undefined> = {
		"--grid-gap": space(gap),
		"--grid-align": align,
		"--grid-justify": justify,
	};
	if (auto) vars["--grid-min"] = minChildWidth;
	else if (cols !== undefined) vars["--grid-cols"] = cols;
	if (capped) vars["--grid-maxcols"] = maxCols;
	const Tag = as as "div";
	return (
		<Tag
			class={cx(
				"ui-grid",
				auto && "ui-grid--auto",
				capped && "ui-grid--capped",
				exact && "ui-grid--exact",
				className as string,
			)}
			style={styleVars(vars, style)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
