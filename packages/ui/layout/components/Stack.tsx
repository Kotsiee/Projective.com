import type { ComponentChildren, CSSProperties, HTMLAttributes, JSX } from "preact";
import "../styles/stack.css";
import { cx } from "../../core/cx.ts";
import { alignValue, justifyValue } from "../../core/flex.ts";
import { space } from "../../core/spacing.ts";
import { styleVars } from "../../core/style.ts";
import type { Align, Justify, Space } from "../../types/mod.ts";

export type StackDirection = "row" | "column";

export interface StackProps extends Omit<HTMLAttributes<HTMLElement>, "style" | "ref"> {
	as?: keyof JSX.IntrinsicElements;
	/** Main-axis direction (default `column`). */
	direction?: StackDirection;
	/** Gap between children. */
	gap?: Space;
	/** Cross-axis alignment (`align-items`). */
	align?: Align;
	/** Main-axis distribution (`justify-content`). */
	justify?: Justify;
	wrap?: boolean;
	inline?: boolean;
	style?: CSSProperties;
	children?: ComponentChildren;
}

/** Stack — flex layout in a single direction with a uniform gap. */
export function Stack(props: StackProps): JSX.Element {
	const {
		as = "div",
		direction = "column",
		gap,
		align,
		justify,
		wrap,
		inline,
		class: className,
		style,
		children,
		...rest
	} = props;
	const vars: Record<string, string | undefined> = {
		"--stack-dir": direction,
		"--stack-gap": space(gap),
		"--stack-align": alignValue(align),
		"--stack-justify": justifyValue(justify),
	};
	const Tag = as as "div";
	return (
		<Tag
			class={cx(
				"ui-stack",
				inline && "ui-stack--inline",
				wrap && "ui-stack--wrap",
				className as string,
			)}
			style={styleVars(vars, style)}
			{...rest}
		>
			{children}
		</Tag>
	);
}
