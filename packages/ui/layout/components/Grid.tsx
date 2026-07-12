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
		gap,
		align,
		justify,
		class: className,
		style,
		children,
		...rest
	} = props;
	const auto = minChildWidth !== undefined;
	const vars: Record<string, string | number | undefined> = {
		"--grid-gap": space(gap),
		"--grid-align": align,
		"--grid-justify": justify,
	};
	if (auto) vars["--grid-min"] = minChildWidth;
	else if (cols !== undefined) vars["--grid-cols"] = cols;
	const Tag = as as "div";
	return (
		<Tag
			class={cx("ui-grid", auto && "ui-grid--auto", className as string)}
			style={styleVars(vars, style)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
